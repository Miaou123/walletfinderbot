const { 
    Connection, 
    PublicKey, 
    Keypair,
    LAMPORTS_PER_SOL 
} = require('@solana/web3.js');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const database = require('../database/database'); 

class SolanaPaymentHandler {
    constructor(heliusUrl) {
        if (!heliusUrl) {
            throw new Error('HELIUS_RPC_URL is not set');
        }
        this.connection = new Connection(heliusUrl, 'confirmed');
        this.mainWallet = new PublicKey(process.env.MAIN_WALLET_ADDRESS);
        this.pendingPayments = new Map();
        
        this.prices = {
            '1month': 0.5,
            '3month': 1.2,
            '6month': 2.0
        };

        this.completedPayments = new Map();
        this.retryDelay = 60000; 
        this.maxRetries = 3;
    }

    async createPaymentSession(username, duration) {
        const sessionId = uuidv4();
        const amount = this.prices[duration];
        
        if (!amount) {
            throw new Error('Invalid duration');
        }
    
        const paymentKeypair = Keypair.generate();
        const paymentData = {
            sessionId,
            username,
            duration,
            amount,
            paymentAddress: paymentKeypair.publicKey.toString(),
            privateKey: paymentKeypair.secretKey,
            created: new Date(),
            expires: new Date(Date.now() + 30 * 60 * 1000),
            status: 'pending'
        };

        await database.savePaymentAddress(paymentData);
        
        this.pendingPayments.set(sessionId, paymentData);
        
        return {
            sessionId,
            paymentAddress: paymentData.paymentAddress,
            amount,
            duration,
            expires: paymentData.expires
        };
    }

    async startPaymentMonitoring() {
        setInterval(async () => {
            for (const [sessionId, paymentData] of this.pendingPayments) {
                try {
                    // Vérifier le solde avant de supprimer
                    const balance = await this.connection.getBalance(new PublicKey(paymentData.paymentAddress));
                    
                    if (new Date() > paymentData.expires) {
                        if (balance > 0) {
                            // Si il y a des fonds, essayer de les transférer avant de supprimer
                            try {
                                await this.transferToMainWallet(paymentData);
                            } catch (error) {
                                logger.error(`Failed to transfer funds from expired session ${sessionId}:`, error);
                                this._saveFailedTransfer(paymentData);
                            }
                        }
                        this.pendingPayments.delete(sessionId);
                        continue;
                    }
                    
                    // Reste de votre code de monitoring...
                } catch (error) {
                    logger.error(`Error monitoring payment for session ${sessionId}:`, error);
                }
            }
        }, 10000);
    }

    async transferToMainWallet(paymentData) {
        let retries = 0;
        while (retries < this.maxRetries) {
            try {
                const signature = await this._attemptTransfer(paymentData);
                this.completedPayments.set(paymentData.sessionId, {
                    signature,
                    timestamp: new Date()
                });
                return signature;
            } catch (error) {
                retries++;
                logger.error(`Transfer attempt ${retries} failed:`, error);
                if (retries < this.maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                }
            }
        }
    
        this._saveFailedTransfer(paymentData);
        throw new Error('Max transfer retries reached');
    }

    _saveFailedTransfer(paymentData) {
        const criticalData = {
            sessionId: paymentData.sessionId,
            paymentAddress: paymentData.paymentAddress,
            privateKey: Buffer.from(paymentData.privateKey).toString('hex'),
            amount: paymentData.amount,
            timestamp: new Date()
        };
        
        logger.error('CRITICAL: Failed transfer data:', criticalData);
    }

    getPaymentStatus(sessionId) {
        const payment = this.pendingPayments.get(sessionId);
        if (!payment) return null;
        return {
            status: payment.status,
            expires: payment.expires,
            amount: payment.amount,
            duration: payment.duration
        };
    }
}

module.exports = SolanaPaymentHandler;