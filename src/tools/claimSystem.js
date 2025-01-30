const {
    Connection,
    PublicKey,
    Keypair,
    SystemProgram,
    Transaction
} = require('@solana/web3.js');
const logger = require('../utils/logger');
const config = require('../utils/config'); 

const { getDatabase } = require('../database/config/connection');

class ClaimSystem {
    constructor(connection, rewardWalletPrivateKey) {
        if (!connection || !rewardWalletPrivateKey) {
            throw new Error('Missing required parameters for ClaimSystem');
        }
        this.connection = connection;

        
        // Configuration des frais et marges
        this.FEES = {
            rentExemptReserve: 1_000_000,    // 0.001 SOL
            rentSafetyMargin: 5000,          // Pour les frais de transaction
            rewardDeduction: 0.005           // 0.5% déduit des rewards pour les frais
        };

        // Initialisation du wallet de récompenses
        try {
            const secretKey = Buffer.from(config.REWARD_WALLET_PRIVATE_KEY, 'base64');
            this.rewardWallet = Keypair.fromSecretKey(secretKey);
            logger.info('Reward wallet initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize reward wallet:', error);
            throw new Error('Invalid reward wallet configuration');
        }
    }

    async verifyClaimEligibility(chatId) {
        const database = await getDatabase();
        const user = await database.collection("users").findOne({ chatId });

        try {
            // Vérifications de base
            if (!user) {
                return { eligible: false, reason: 'User not found' };
            }
            if (!user.referralWallet) {
                return { eligible: false, reason: 'No wallet address configured' };
            }

            const unclaimedAmount = parseFloat(user.unclaimedRewards || 0);
            if (unclaimedAmount <= 0) {
                return { eligible: false, reason: 'No rewards to claim' };
            }

            // Vérifier le solde du wallet de récompenses
            const balance = await this.connection.getBalance(this.rewardWallet.publicKey);
            const balanceInSOL = balance / 1e9;

            if (balanceInSOL < unclaimedAmount) {
                logger.error(`Insufficient funds in reward wallet. Balance: ${balanceInSOL} SOL, Required: ${unclaimedAmount} SOL`);
                return { eligible: false, reason: 'Reward pool temporarily unavailable' };
            }

            // Calculer le montant final après déduction des frais
            const finalAmount = unclaimedAmount * (1 - this.FEES.rewardDeduction);

            return {
                eligible: true,
                originalAmount: unclaimedAmount,
                amount: finalAmount,
                walletAddress: user.referralWallet
            };
        } catch (error) {
            logger.error('Error checking claim eligibility:', error);
            return { eligible: false, reason: 'Error checking eligibility' };
        }
    }

    async processClaim(chatId) {
        const eligibility = await this.verifyClaimEligibility(chatId);
        
        if (!eligibility.eligible) {
            return { success: false, reason: eligibility.reason };
        }

        try {
            // Effectuer le transfert
            const transferResult = await this.transferRewards(
                eligibility.walletAddress,
                eligibility.amount
            );

            if (!transferResult.success) {
                return { success: false, reason: transferResult.error };
            }

            // Mettre à jour la base de données
            const database = await getDatabase();
            await database.collection("users").updateOne(
                { chatId },
                {
                    $inc: {
                        unclaimedRewards: -eligibility.originalAmount,
                        claimedRewards: eligibility.amount
                    },
                    $set: {
                        lastUpdated: new Date()
                    }
                }
            );

            return {
                success: true,
                amount: eligibility.amount,
                originalAmount: eligibility.originalAmount,
                deductedFees: eligibility.originalAmount - eligibility.amount,
                transactionSignature: transferResult.signature
            };

        } catch (error) {
            logger.error('Error processing claim:', error);
            return { success: false, reason: 'Transaction failed' };
        }
    }

    async transferRewards(destinationAddress, amount) {
        const maxRetries = 3; // Maximum number of attempts
        const retryDelay = 2000; // Delay between retries (milliseconds)
    
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                logger.info(`💰 Attempt ${attempt}/${maxRetries} to send ${amount} SOL to ${destinationAddress}...`);
    
                const destinationPubkey = new PublicKey(destinationAddress);
                const lamportsToSend = Math.floor(amount * 1e9);
    
                const instruction = SystemProgram.transfer({
                    fromPubkey: this.rewardWallet.publicKey,
                    toPubkey: destinationPubkey,
                    lamports: lamportsToSend
                });
    
                let transaction = new Transaction().add(instruction);
                const latestBlockhash = await this.connection.getLatestBlockhash();
                transaction.recentBlockhash = latestBlockhash.blockhash;
                transaction.feePayer = this.rewardWallet.publicKey;

                // Verify transaction fee
                const messageBytes = transaction.compileMessage();
                const feeResult = await this.connection.getFeeForMessage(messageBytes, 'confirmed');
                
                if (feeResult.value === null) {
                    throw new Error('Unable to calculate transaction fee');
                }
    
                const signature = await this.connection.sendTransaction(transaction, [this.rewardWallet]);
    
                await this.connection.confirmTransaction({
                    signature,
                    blockhash: latestBlockhash.blockhash,
                    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
                });
    
                logger.info(`✅ Transaction successful (Attempt ${attempt}/${maxRetries}): ${signature}`);
                return { success: true, signature, amount };
    
            } catch (error) {
                logger.error(`❌ Transaction failed (Attempt ${attempt}/${maxRetries}): ${error.message}`);
    
                if (attempt < maxRetries) {
                    logger.info(`⏳ Waiting ${retryDelay / 1000} seconds before retrying...`);
                    await new Promise(res => setTimeout(res, retryDelay)); // Pause before retry
                } else {
                    logger.error(`❌ Transaction abandoned after ${maxRetries} attempts.`);
                    return { 
                        success: false, 
                        error: "Transaction failed after multiple attempts. Please try again later or contact support." 
                    };
                }
            }
        }
    }
}

module.exports = ClaimSystem;