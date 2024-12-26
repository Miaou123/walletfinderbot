const { 
    Connection, 
    PublicKey, 
    Keypair,
    LAMPORTS_PER_SOL 
} = require('@solana/web3.js');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

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
    }

    async createPaymentSession(username, duration) {
        const sessionId = uuidv4();
        const amount = this.prices[duration];
        
        if (!amount) {
            throw new Error('Invalid duration');
        }

        // Générer une nouvelle paire de clés pour ce paiement
        const paymentKeypair = Keypair.generate();

        const paymentData = {
            sessionId,
            username,
            duration,
            amount,
            paymentAddress: paymentKeypair.publicKey.toString(),
            privateKey: paymentKeypair.secretKey,
            created: new Date(),
            expires: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
            status: 'pending'
        };

        this.pendingPayments.set(sessionId, paymentData);
        
        // On retourne uniquement les infos nécessaires à l'utilisateur
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
                    // Nettoyer les sessions expirées
                    if (new Date() > paymentData.expires) {
                        this.pendingPayments.delete(sessionId);
                        continue;
                    }

                    const balance = await this.connection.getBalance(new PublicKey(paymentData.paymentAddress));
                    const solBalance = balance / LAMPORTS_PER_SOL;

                    // Si le paiement est reçu
                    if (solBalance >= paymentData.amount) {
                        await this.transferToMainWallet(paymentData);
                        paymentData.status = 'completed';
                        
                        // Émettre un événement ou callback ici si nécessaire
                        if (this.onPaymentReceived) {
                            this.onPaymentReceived(paymentData);
                        }
                    }
                } catch (error) {
                    logger.error(`Error monitoring payment for session ${sessionId}:`, error);
                }
            }
        }, 10000); // Check toutes les 10 secondes
    }

    async transferToMainWallet(paymentData) {
        try {
            const paymentKeypair = Keypair.fromSecretKey(paymentData.privateKey);
            const balance = await this.connection.getBalance(paymentKeypair.publicKey);
            
            const fees = 5000; // Frais estimés
            const transferAmount = balance - fees;

            if (transferAmount <= 0) return;

            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: paymentKeypair.publicKey,
                    toPubkey: this.mainWallet,
                    lamports: transferAmount
                })
            );

            const signature = await this.connection.sendTransaction(
                transaction,
                [paymentKeypair]
            );

            await this.connection.confirmTransaction(signature);
            return signature;
        } catch (error) {
            logger.error('Error transferring to main wallet:', error);
            throw error;
        }
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