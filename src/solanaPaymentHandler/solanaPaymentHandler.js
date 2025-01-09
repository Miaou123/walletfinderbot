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
        this.retryHandler = new RetryableOperation();

        this.prices = {
            '1month': 0.5,
            '3month': 1.2,
            '6month': 2.0
        };

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
        
        for (const [sessionId, session] of this.sessions) {
            if (session.expiresAt.getTime() < now) {
                this.sessions.delete(sessionId);
                cleanedCount++;
            }
        }
        
        if (cleanedCount > 0) {
            logger.info(`Cleaned up ${cleanedCount} expired payment sessions`);
        }
    }

    async createPaymentSession(username, duration) {
        const sessionId = uuidv4();
        const amount = this.prices[duration];
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
            duration,
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
        return this.sessions.get(sessionId) || null;
    }

    async checkPayment(sessionId) {
        const session = this.getPaymentSession(sessionId);
        if (!session) {
            return { success: false, reason: 'Session not found.' };
        }

        if (Date.now() > session.expiresAt.getTime()) {
            return { success: false, reason: 'Session expired.' };
        }

        if (session.paid) {
            return { success: true, alreadyPaid: true };
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
                session.paid = true;
                // Récupérer le hash de la dernière transaction entrante
                const lastTransaction = signatures[0]?.signature || null;
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
    
    async createGroupPaymentSession(groupId, groupName, adminInfo) {
        const sessionId = uuidv4();
        const duration = '1month'; // Durée fixe pour les groupes
        const amount = this.groupPrice;

        const paymentKeypair = Keypair.generate();
        const base64Key = Buffer.from(paymentKeypair.secretKey).toString('base64');

        // Log pour les tests
        logger.info(`TEST INFO - Group Payment Session Creation:`);
        logger.info(`TEST INFO - Payment Address: ${paymentKeypair.publicKey.toString()}`);
        logger.info(`TEST INFO - Private Key (base64): ${base64Key}`);
        logger.info(`TEST INFO - Private Key (array): [${Array.from(paymentKeypair.secretKey)}]`);

        const paymentData = {
            sessionId,
            groupId,
            groupName,
            adminInfo, // Information sur l'admin qui initie le paiement
            duration,
            amount,
            paymentAddress: paymentKeypair.publicKey.toString(),
            privateKey: base64Key,
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + this.sessionValidityMs),
            paid: false,
            type: 'group' // Marquer explicitement comme session de groupe
        };

        try {
            await database.savePaymentAddress({
                ...paymentData,
                status: 'pending'
            });
            
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
        if (!session || session.type !== 'group') {
            return { success: false, reason: 'Invalid group payment session.' };
        }

        if (Date.now() > session.expiresAt.getTime()) {
            return { success: false, reason: 'Session expired.' };
        }

        if (session.paid) {
            return { success: true, alreadyPaid: true };
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
                `Balance of group payment address ${session.paymentAddress}: ${balanceSol} SOL (expected: ${session.amount})`
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
            } else {
                return {
                    success: false,
                    reason: 'Payment not detected yet',
                    partialBalance: balanceSol
                };
            }
        } catch (error) {
            logger.error(`Error checking group payment for session ${sessionId}:`, error);
            return { success: false, reason: 'Error checking Solana balance' };
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