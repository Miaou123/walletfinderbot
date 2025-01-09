const {
    Connection,
    PublicKey,
    Keypair,
    SystemProgram,
    Transaction
} = require('@solana/web3.js');

const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const database = require('../database/database');
require('dotenv').config();

class RetryableOperation {
    async execute(operation, maxRetries = 3) {
        let lastError;
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
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

        this.price = 0.5;

        this.groupPrice = 2.0;
        
        this.sessionValidityMs = 30 * 60 * 1000;
        this.mainWalletAddress = process.env.MAIN_WALLET_ADDRESS;
        
        if (!this.mainWalletAddress) {
            logger.warn('MAIN_WALLET_ADDRESS not set. transferFunds() will fail if called.');
        }

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

    async createPaymentSession(username, duration) {
        const sessionId = uuidv4();
        const amount = this.price;
        if (!amount) {
            throw new Error(`Invalid duration "${duration}". Expected one of: 1month, 3month, 6month`);
        }

        const paymentKeypair = Keypair.generate();
        const base64Key = Buffer.from(paymentKeypair.secretKey).toString('base64');

        // Log pour les tests
        logger.info(`TEST INFO - Payment Address: ${paymentKeypair.publicKey.toString()}`);
        logger.info(`TEST INFO - Private Key (base64): ${base64Key}`);
        logger.info(`TEST INFO - Private Key (array): [${Array.from(paymentKeypair.secretKey)}]`);

        const paymentData = {
            sessionId,
            username,
            type: 'private',
            duration: '1month',
            amount,
            paymentAddress: paymentKeypair.publicKey.toString(),
            privateKey: base64Key,
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + this.sessionValidityMs),
            paid: false
        };

        try {
            await database.savePaymentAddress(paymentData);
            this.sessions.set(sessionId, paymentData);

            logger.info(
                `Created payment session ${sessionId} for user "${username}" (duration: ${duration}, amount: ${amount} SOL)`
            );

            return {
                sessionId,
                paymentAddress: paymentData.paymentAddress,
                amount,
                duration,
                expires: paymentData.expiresAt
            };

        } catch (err) {
            logger.error(`Failed to save payment address (session ${sessionId}) in DB:`, err);
            throw new Error(`Could not create payment session: ${err.message}`);
        }
    }

    getPaymentSession(sessionId) {
        // Enlever tous les préfixes possibles
        const cleanSessionId = sessionId.replace(/^(check_group_|group_|check_)/, '');
        
        // Essayer de trouver la session avec différents formats
        const sessionTypes = [
            cleanSessionId,              // ID nu
            `group_${cleanSessionId}`,   // Session de groupe
            `${cleanSessionId}`          // Autre format
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
            ${session.groupName ? `Group: ${session.groupName}` : `User: ${session.username}`}, 
            Paid: ${session.paid}`
        );
        
        return session;
    }

    async checkPayment(sessionId) {
        const session = this.getPaymentSession(sessionId);
    
        if (!session) {
            return { success: false, reason: 'Session not found.' };
        }
    
        if (session.type === 'group') {
            return this.checkGroupPayment(sessionId);
        }
    
        if (Date.now() > session.expiresAt.getTime()) {
            return { success: false, reason: 'Session expired.' };
        }
    
        if (session.paid) {
            return { 
                success: true, 
                alreadyPaid: true,
                transactionHash: session.transactionHash // Ajouter le hash existant
            };
        }
    
        try {
            // Récupérer l'historique des transactions
            const signatures = await this.connection.getSignaturesForAddress(
                new PublicKey(session.paymentAddress),
                { limit: 10 }
            );
    
            const balanceLamports = await this.connection.getBalance(
                new PublicKey(session.paymentAddress)
            );
            const balanceSol = balanceLamports / 1e9;
    
            logger.info(
                `Balance of address ${session.paymentAddress}: ${balanceSol} SOL (expected: ${session.amount})`
            );
    
            if (balanceSol >= session.amount) {
                // Vérifier que nous avons bien trouvé la transaction
                if (!signatures || signatures.length === 0) {
                    logger.error(`No transaction signatures found for a funded address: ${session.paymentAddress}`);
                    return {
                        success: false,
                        reason: 'Payment detected but transaction signature not found'
                    };
                }
    
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
    
                return { 
                    success: true,
                    transactionHash: lastTransaction 
                };
            } else {
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
    
    createGroupPaymentSession(groupId, groupName, adminInfo) {
        if (!groupId || !groupName || !adminInfo) {
            throw new Error('Missing required parameters for group payment session');
        }
    
        const sessionId = `group_${uuidv4()}`;  // Préfixer explicitement les sessions de groupe
        const duration = '1month';
        const amount = this.groupPrice;
    
        const paymentKeypair = Keypair.generate();
        const base64Key = Buffer.from(paymentKeypair.secretKey).toString('base64');
    
        const paymentData = {
            sessionId,  // Conserver le préfixe dans l'ID
            groupId,
            groupName,
            type: 'group',
            adminInfo,
            duration,
            amount,
            paymentAddress: paymentKeypair.publicKey.toString(),
            privateKey: base64Key,
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + this.sessionValidityMs),
            paid: false
        };
    
        try {
            database.savePaymentAddress(paymentData);
            this.sessions.set(sessionId, paymentData);
    
            logger.info(
                `Created group payment session ${sessionId} for group "${groupName}" (${groupId}) by admin ${adminInfo.username}`
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
            const signatures = await this.connection.getSignaturesForAddress(
                new PublicKey(session.paymentAddress),
                { limit: 10 }
            );
    
            const balanceLamports = await this.connection.getBalance(
                new PublicKey(session.paymentAddress)
            );
            const balanceSol = balanceLamports / 1e9;
    
            logger.info(
                `Balance of group address ${session.paymentAddress}: ${balanceSol} SOL (expected: ${session.amount})`
            );
    
            if (balanceSol >= session.amount) {
                session.paid = true;
                const lastTransaction = signatures[0]?.signature || null;
                session.transactionHash = lastTransaction;
                this.sessions.set(sessionId, session);
    
                return { 
                    success: true,
                    transactionHash: lastTransaction 
                };
            }
    
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
        const session = this.getPaymentSession(sessionId);
        if (!session?.paid) {
            throw new Error('Session not found or not paid.');
        }
        if (!this.mainWalletAddress) {
            throw new Error('MAIN_WALLET_ADDRESS not configured.');
        }
    
        return this.retryHandler.execute(async () => {
            const rawPrivateKey = Buffer.from(session.privateKey, 'base64');
            const keypair = Keypair.fromSecretKey(rawPrivateKey);
    
            const lamports = await this.connection.getBalance(keypair.publicKey);
            if (lamports === 0) {
                throw new Error('No funds to transfer (balance=0).');
            }
    
            const instruction = SystemProgram.transfer({
                fromPubkey: keypair.publicKey,
                toPubkey: new PublicKey(this.mainWalletAddress),
                lamports
            });
    
            let transaction = new Transaction().add(instruction);
    
            const latestBlockhash = await this.connection.getLatestBlockhash();
            transaction.recentBlockhash = latestBlockhash.blockhash;
            transaction.feePayer = keypair.publicKey;
    
            const messageBytes = transaction.compileMessage();
            const feeResult = await this.connection.getFeeForMessage(messageBytes, 'confirmed');
    
            if (feeResult.value === null) {
                throw new Error('Unable to calculate transaction fee.');
            }
    
            const requiredFee = feeResult.value;
            if (lamports <= requiredFee) {
                throw new Error(
                    `Not enough balance to cover fee. Balance=${lamports}, fee=${requiredFee}`
                );
            }
    
            const lamportsToSend = lamports - requiredFee;
            const finalInstruction = SystemProgram.transfer({
                fromPubkey: keypair.publicKey,
                toPubkey: new PublicKey(this.mainWalletAddress),
                lamports: lamportsToSend
            });
    
            transaction = new Transaction().add(finalInstruction);
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
    
            // Sauvegarder le hash du transfert
            session.transferHash = signature;
            this.sessions.set(sessionId, session);
    
            return { 
                signature, 
                transactionHash: session.transactionHash 
            };
        });
    }

    // Méthode utilitaire pour les tests
    getPrivateKey(sessionId) {
        const session = this.getPaymentSession(sessionId);
        return session?.privateKey || null;
    }
}

module.exports = SolanaPaymentHandler;