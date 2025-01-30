const {
    Connection,
    PublicKey,
    Keypair,
    SystemProgram,
    Transaction,
    ComputeBudgetProgram
} = require('@solana/web3.js');

const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const { PaymentService, UserService  } = require('../database');
const { SubscriptionConfig: { SUBSCRIPTION_TYPES, calculateSubscriptionPrice } } = require('../database');
require('dotenv').config();

class RetryableOperation {
    async execute(operation, maxRetries = 3) {
        let lastError;
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await operation(i);
            } catch (error) {
                lastError = error;
                logger.error(
                    `[RetryableOperation] Attempt #${i + 1} failed: ${error.message}`,
                    { stack: error.stack }
                );
                // Backoff exponentiel
                await new Promise(resolve => setTimeout(
                    resolve,
                    1000 * Math.pow(2, i)
                ));
            }
        }
        throw lastError;
    }
}

class SolanaPaymentHandler {
    constructor(heliusUrl) {
        if (!heliusUrl) {
            throw new Error('HELIUS_RPC_URL is not set');
        }
        this.connection = new Connection(heliusUrl, 'confirmed');
        this.sessions = new Map();

        const originalSet = this.sessions.set.bind(this.sessions);
        this.sessions.set = (key, value) => {
            logger.debug(`Adding session ${key} to Map`);
            return originalSet(key, value);
        };

        this.retryHandler = new RetryableOperation();

        // Use centralized configuration
        this.price = SUBSCRIPTION_TYPES.USER.price;
        this.groupPrice = SUBSCRIPTION_TYPES.GROUP.price;
        this.sessionValidityMs = 30 * 60 * 1000;

        this.mainWalletAddress = process.env.MAIN_WALLET_ADDRESS;

        if (!this.mainWalletAddress) {
            logger.warn('MAIN_WALLET_ADDRESS not set. transferFunds() will fail if called.');
        }

        // Nettoyage périodique des sessions expirées
        setInterval(() => this.cleanupExpiredSessions(), 30 * 60 * 1000);
    }

    cleanupExpiredSessions() {
        const now = Date.now();
        let cleanedCount = 0;

        logger.debug('Starting cleanup of expired sessions...');
        logger.debug(`Current time: ${new Date(now).toISOString()}`);
        logger.debug('Sessions before cleanup:', Array.from(this.sessions.keys()));

        for (const [sessionId, session] of this.sessions) {
            const expiryTime = session.expiresAt.getTime();
            logger.debug(`Session ${sessionId} expires at: ${session.expiresAt.toISOString()}`);

            if (expiryTime < now) {
                logger.debug(`Cleaning up session ${sessionId}, expired at ${session.expiresAt}`);
                this.sessions.delete(sessionId);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            logger.info(`Cleaned up ${cleanedCount} expired payment sessions`);
        }
        logger.debug('Sessions after cleanup:', Array.from(this.sessions.keys()));
    }

    async createPaymentSession(userId, chatId, username, duration, referralLink = null) {
        const baseAmount = SUBSCRIPTION_TYPES.USER.price;
        
        // Vérifier si l'utilisateur a un parrain
        const user = await UserService.getUserById(userId);
        const hasReferrer = user && user.referredBy;
        
        // Calculer le prix final avec la réduction si applicable
        const finalAmount = hasReferrer ? baseAmount * 0.9 : baseAmount;
        
        const sessionId = uuidv4();
        const paymentKeypair = Keypair.generate();
        const base64Key = Buffer.from(paymentKeypair.secretKey).toString('base64');

        const paymentData = {
            sessionId,
            type: 'private',
            userId,
            chatId,         // Utiliser le vrai chatId
            username,       // Utiliser le vrai username
            paymentAddress: paymentKeypair.publicKey.toString(),
            privateKey: base64Key,
            baseAmount,
            finalAmount,
            referralLinkUsed: referralLink,
            duration: duration || '1month',
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + this.sessionValidityMs),
            status: 'pending',
            lastUpdated: new Date(),
        };

        
        logger.debug('Payment session data being saved:', paymentData);

        try {
            await PaymentService.savePaymentAddress(paymentData);
            this.sessions.set(sessionId, paymentData);
            logger.debug('Session saved to Map:', this.sessions.get(sessionId));

            logger.debug(
                `Created payment session ${sessionId} for user "${username}" (duration: ${duration}, amount: ${finalAmount} SOL)`
            );

            return {
                sessionId,
                paymentAddress: paymentData.paymentAddress,
                finalAmount: finalAmount,
                duration: '1month',
                expires: paymentData.expiresAt
            };

        } catch (err) {
            logger.error(`Failed to save payment address (session ${sessionId}) in DB:`, err);
            throw new Error(`Could not create payment session: ${err.message}`);
        }
    }

    getPaymentSession(sessionId) {
        // Enlever les préfixes éventuels (check_group_, group_, check_):
        const cleanSessionId = sessionId.replace(/^(check_group_|group_|check_)/, '');

        const sessionTypes = [
            cleanSessionId,             // ID nu
            `group_${cleanSessionId}`,  // Session de groupe
            `${cleanSessionId}`
        ];

        let session = null;
        for (const trySessionId of sessionTypes) {
            session = this.sessions.get(trySessionId);
            if (session) break;
        }

        if (!session) {
            logger.warn(`No session found for ID: ${sessionId}`);
            logger.debug('Available sessions:',
                Array.from(this.sessions.keys()).map(key =>
                    `${key}: ${this.sessions.get(key)?.type || 'unknown'}`
                )
            );
            return null;
        }

        logger.debug(`Retrieved session:
            ID: ${session.sessionId},
            Type: ${session.type},
            ${session.groupName ? 
                `Group: ${session.groupName}, Admin: ${session.adminInfo.userId}` : 
                `User: ${session.username} (${session.userId})`},
            Paid: ${session.paid}
        `);

        return session;
    }

    async checkPayment(sessionId) {
        const session = this.getPaymentSession(sessionId);
    
        if (!session) {
            return { success: false, reason: 'Session not found.' };
        }
    
        // Si c'est un groupe, on redirige vers checkGroupPayment
        if (session.type === 'group') {
            return this.checkGroupPayment(sessionId);
        }
    
        // Session expirée ?
        if (Date.now() > session.expiresAt.getTime()) {
            return { success: false, reason: 'Session expired.' };
        }
    
        // Session déjà payée ?
        if (session.paid) {
            return {
                success: true,
                alreadyPaid: true,
                transactionHash: session.transactionHash
            };
        }
    
        try {
            // 1) Récupérer les signatures (première tentative)
            let signatures = await this.connection.getSignaturesForAddress(
                new PublicKey(session.paymentAddress),
                { limit: 10 }
            );
    
            // 2) Vérifier le solde actuel
            let balanceLamports = await this.connection.getBalance(
                new PublicKey(session.paymentAddress)
            );
            let balanceSol = balanceLamports / 1e9;
    
            logger.info(
                `Balance of address ${session.paymentAddress}: ${balanceSol} SOL (expected: ${session.finalAmount})`
            );
    
            // Si le solde est >= session.finalAmount, on considère qu'il y a un paiement
            if (balanceSol >= session.finalAmount) {
                // Vérif signatures
                if (!signatures || signatures.length === 0) {
                    logger.warn(`No transaction signatures found on first attempt. Retrying in 2s...`);
                    // Petit délai pour laisser le temps de l'indexation
                    await new Promise(res => setTimeout(res, 2000));
    
                    // 2ème tentative
                    signatures = await this.connection.getSignaturesForAddress(
                        new PublicKey(session.paymentAddress),
                        { limit: 10 }
                    );
    
                    balanceLamports = await this.connection.getBalance(
                        new PublicKey(session.paymentAddress)
                    );
                    balanceSol = balanceLamports / 1e9;
    
                    logger.info(`(Retry) Balance is ${balanceSol} SOL. Checking signatures again...`);
                    if (!signatures || signatures.length === 0) {
                        logger.error(`No transaction signatures found for address: ${session.paymentAddress} (after retry)`);
                        return {
                            success: false,
                            reason: 'Payment detected but transaction signature not found'
                        };
                    }
                }
    
                // Ici, on a au moins une signature dans signatures
                const lastTransaction = signatures[0].signature;
                if (!lastTransaction) {
                    logger.error(`Invalid transaction signature for address: ${session.paymentAddress}`);
                    return {
                        success: false,
                        reason: 'Payment detected but invalid transaction signature'
                    };
                }
    
                session.paid = true;
                session.transactionHash = lastTransaction;
                this.sessions.set(sessionId, session);
    
                // On récupère toutes les signatures pour info
                const allSigs = signatures.map(sigInfo => sigInfo.signature).filter(Boolean);
    
                return {
                    success: true,
                    transactionHash: lastTransaction,
                    allSignatures: allSigs
                };
            } else {
                // Solde insuffisant => pas de paiement détecté
                return {
                    success: false,
                    reason: 'Payment not detected yet',
                    partialBalance: balanceSol
                };
            }
        } catch (error) {
            logger.error(`Error checking payment for session ${sessionId}:`, error);
            return { success: false, reason: 'Error checking Solana balance' };
        }
    }    

    createGroupPaymentSession(chatId, groupName, adminInfo) {
        if (!chatId || !groupName || !adminInfo) {
            throw new Error('Missing required parameters for group payment session');
        }

        const sessionId = `group_${uuidv4()}`;
        const duration = '1month';
        const amount = this.groupPrice;

        const paymentKeypair = Keypair.generate();
        const base64Key = Buffer.from(paymentKeypair.secretKey).toString('base64');

        // Log (débug) pour local
        logger.debug(`TEST INFO - Payment Address: ${paymentKeypair.publicKey.toString()}`);
        logger.debug(`TEST INFO - Private Key (base64): ${base64Key}`);

        const paymentData = {
            sessionId,
            type: 'group',
            userId: adminInfo.userId,
            chatId,
            username: groupName,
            paymentAddress: paymentKeypair.publicKey.toString(),
            privateKey: base64Key,
            baseAmount: amount,
            finalAmount: amount,
            referralLinkUsed: null,
            duration,
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + this.sessionValidityMs),
            status: "pending",
            lastUpdated: new Date()
        };

        logger.debug('Payment session data being saved:', paymentData);

        try {
            PaymentService.savePaymentAddress(paymentData);
            this.sessions.set(sessionId, paymentData);

            logger.info(
                `Created group payment session ${sessionId} for group "${groupName}" (${chatId}) by admin ${adminInfo.username}`
            );

            return {
                sessionId,
                paymentAddress: paymentData.paymentAddress,
                amount,
                duration,
                expires: paymentData.expiresAt
            };

        } catch (err) {
            logger.error(`Failed to save group payment address (session ${sessionId}) in DB:`, err);
            throw new Error(`Could not create group payment session: ${err.message}`);
        }
    }

    async checkGroupPayment(sessionId) {
        const session = this.getPaymentSession(sessionId);
        if (!session) {
            return { success: false, reason: 'Session not found.' };
        }
    
        if (session.type !== 'group') {
            logger.error(`Attempted group payment check on non-group session: ${sessionId}`);
            return { success: false, reason: 'Invalid session type.' };
        }
    
        if (Date.now() > session.expiresAt.getTime()) {
            return { success: false, reason: 'Session expired.' };
        }
    
        if (session.paid) {
            return {
                success: true,
                alreadyPaid: true,
                transactionHash: session.transactionHash
            };
        }
    
        try {
            // 1) Récupérer les signatures
            let signatures = await this.connection.getSignaturesForAddress(
                new PublicKey(session.paymentAddress),
                { limit: 10 }
            );
    
            // 2) Vérifier le solde actuel
            let balanceLamports = await this.connection.getBalance(
                new PublicKey(session.paymentAddress)
            );
            let balanceSol = balanceLamports / 1e9;
    
            logger.info(
                `Balance of group address ${session.paymentAddress}: ${balanceSol} SOL (expected: ${session.finalAmount})`
            );
    
            // Si le solde est >= session.finalAmount, on s'attend à voir au moins une signature
            if (balanceSol >= session.finalAmount) {
                // On parcourt toutes les signatures qu'on vient d'obtenir
                let foundSignatures = [];
                if (signatures && signatures.length > 0) {
                    for (const sigInfo of signatures) {
                        if (sigInfo.signature) {
                            foundSignatures.push(sigInfo.signature);
                        }
                    }
                }
    
                // Si on n'a trouvé aucune signature alors que le solde est suffisant, on retente un court délai
                if (foundSignatures.length === 0) {
                    logger.warn(`No signatures found on first attempt despite enough balance. Retrying...`);
                    
                    // Petit délai (ex: 2 secondes) pour laisser le cluster indexer la TX
                    await new Promise(res => setTimeout(res, 2000));
    
                    // Deuxième tentative
                    signatures = await this.connection.getSignaturesForAddress(
                        new PublicKey(session.paymentAddress),
                        { limit: 10 }
                    );
                    balanceLamports = await this.connection.getBalance(
                        new PublicKey(session.paymentAddress)
                    );
                    balanceSol = balanceLamports / 1e9;
    
                    logger.info(`(Retry) Balance is ${balanceSol} SOL. Checking signatures again...`);
    
                    foundSignatures = [];
                    if (signatures && signatures.length > 0) {
                        for (const sigInfo of signatures) {
                            if (sigInfo.signature) {
                                foundSignatures.push(sigInfo.signature);
                            }
                        }
                    }
                }
    
                // Après le retry, si toujours aucune signature => on arrête
                if (foundSignatures.length === 0) {
                    logger.error(`No transaction signatures found (even after retry) for address: ${session.paymentAddress}`);
                    return {
                        success: false,
                        reason: 'Payment detected but transaction signatures not found'
                    };
                }
    
                // => on prend la première comme la "principale"
                const lastTransaction = foundSignatures[0] || '';
                session.paid = true;
                session.transactionHash = lastTransaction;
                this.sessions.set(sessionId, session);
    
                // On renvoie toutes les signatures pour info (possible que la "bonne" soit [1], etc.)
                return {
                    success: true,
                    transactionHash: lastTransaction,
                    allSignatures: foundSignatures
                };
            }
    
            // Si le solde est toujours insuffisant
            return {
                success: false,
                reason: 'Payment not detected yet',
                partialBalance: balanceSol
            };
        } catch (error) {
            logger.error(`Error checking group payment for session ${sessionId}:`, error);
            return { success: false, reason: error.message || 'Error checking Solana balance' };
        }
    }    

    async transferFunds(sessionId) {
        logger.info(`[transferFunds] Attempting to transfer funds for session: ${sessionId}`);
        
        const session = this.getPaymentSession(sessionId);
        logger.debug(`[transferFunds] Session details: ${JSON.stringify(session)}`);
    
        if (!session?.paid) {
            logger.warn(`[transferFunds] Session not found or not paid: ${sessionId}`);
            throw new Error('Session not found or not paid.');
        }
        if (!this.mainWalletAddress) {
            logger.warn('[transferFunds] Main wallet address not configured');
            throw new Error('MAIN_WALLET_ADDRESS not configured.');
        }
    
        const rentExemptReserve = 1_000_000; // 0.001 SOL
        const rentSafetyMargin = 5000;

        return this.retryHandler.execute(async (attemptIndex) => {
            try {
                const rawPrivateKey = Buffer.from(session.privateKey, 'base64');
                logger.debug(`[transferFunds] Using private key: ${rawPrivateKey.toString('base64')}`);
                
                const keypair = Keypair.fromSecretKey(rawPrivateKey);
                logger.debug(`[transferFunds] Keypair public key: ${keypair.publicKey.toString()}`);
    
                let lamports = await this.connection.getBalance(keypair.publicKey);
                logger.info(`[transferFunds] Current balance: ${lamports} lamports`);
    
                if (lamports === 0) {
                    logger.warn('[transferFunds] No funds to transfer (balance=0)');
                    throw new Error('No funds to transfer (balance=0).');
                }
    

                // On prépare d’abord un faux "transfer" pour calculer le fee
                const instruction = SystemProgram.transfer({
                    fromPubkey: keypair.publicKey,
                    toPubkey: new PublicKey(this.mainWalletAddress),
                    lamports
                });

                let transaction = new Transaction().add(instruction);
                const latestBlockhash = await this.connection.getLatestBlockhash();
                transaction.recentBlockhash = latestBlockhash.blockhash;
                transaction.feePayer = keypair.publicKey;

                // Calcul du fee
                const messageBytes = transaction.compileMessage();
                const feeResult = await this.connection.getFeeForMessage(messageBytes, 'confirmed');

                if (feeResult.value === null) {
                    throw new Error('Unable to calculate transaction fee.');
                }

                const requiredFee = feeResult.value;

                // Vérif basique pour être sûr qu'on ait un petit delta rent-exempt :
                if (lamports < (requiredFee + rentSafetyMargin)) {
                    throw new Error(
                        `Not enough balance to cover fee + rentSafetyMargin. 
                        Balance=${lamports}, 
                        Fee=${requiredFee}, 
                        Margin=${rentSafetyMargin}`
                    );
                }

                // Recalcul final
                const lamportsToSend = lamports - requiredFee - rentSafetyMargin - rentExemptReserve;

                if (lamportsToSend <= 0) {
                    throw new Error(
                        `After subtracting fee and safety margin, there's nothing left to transfer! 
                        Balance=${lamports}, 
                        Fee=${requiredFee}, 
                        Margin=${rentSafetyMargin}`
                    );
                }

                const finalInstruction = SystemProgram.transfer({
                    fromPubkey: keypair.publicKey,
                    toPubkey: new PublicKey(this.mainWalletAddress),
                    lamports: lamportsToSend
                });

                transaction = new Transaction()
                    .add(finalInstruction);

                transaction.recentBlockhash = latestBlockhash.blockhash;
                transaction.feePayer = keypair.publicKey;

                const signature = await this.connection.sendTransaction(transaction, [keypair]);
                await this.connection.confirmTransaction(
                    {
                        signature,
                        blockhash: latestBlockhash.blockhash,
                        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
                    },
                    'confirmed'
                );

                session.transferHash = signature;
                this.sessions.set(sessionId, session);

                logger.info(`[transferFunds] Transfer success on attempt #${attemptIndex + 1}. Signature: ${signature}`);

                return {
                    signature,
                    transactionHash: session.transactionHash
                };
            } catch (err) {
                // Log additionnel pour inspection
                logger.error(`[transferFunds] Attempt #${attemptIndex + 1} error: ${err.message}`, {
                    stack: err.stack
                });

                // Si c’est un message "Insufficient Funds For Rent", on peut lever une erreur plus parlante
                if (err.message.includes('Insufficient Funds For Rent')) {
                    throw new Error(`Rent-exemption error. Original: ${err.message}`);
                }
                throw err;
            }
        });
    }

    // Méthode utilitaire pour les tests
    getPrivateKey(sessionId) {
        const session = this.getPaymentSession(sessionId);
        return session?.privateKey || null;
    }
}

module.exports = SolanaPaymentHandler;
