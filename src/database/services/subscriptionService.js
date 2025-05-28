const { getDatabase } = require('../config/connection');
const { validateSubscription } = require('../models/subscription');
const { validateGroupSubscription } = require('../models/group_subscription');
const { SUBSCRIPTION_TYPES } = require('../config/subscriptionConfig');
const UserService = require('./userService');
const logger = require('../../utils/logger');

const REFERRAL_DISCOUNT = 0.9;

class SubscriptionService {
    static SUBSCRIPTION_TYPES = SUBSCRIPTION_TYPES;

    static async calculateSubscriptionPrice(type, referralLink = null) {
        const config = SUBSCRIPTION_TYPES[type.toUpperCase()];
        
        if (!config) {
            throw new Error(`Invalid subscription type: ${type}`);
        }
    
        let price = config.price;
    
        if (referralLink) {
            const isValidReferral = await UserService.isValidReferralLink(referralLink);
            if (isValidReferral) {
                price *= REFERRAL_DISCOUNT;
            }
        }
    
        return price;
    }

    static async createOrUpdateSubscription(msg, paymentId, amount, transactionHashes = {}) {
        const database = await getDatabase();
        const collection = database.collection("subscriptions");
        logger.debug("Debugging msg object in createOrUpdateSubscription:", { msg });

        if (!msg || !msg.from || !msg.from.id) {
            logger.error("Invalid message format: msg.from.id is missing", { msg });
            throw new Error("Invalid message format: missing user ID.");
        }

        const userId = msg.from?.id?.toString() || msg.message?.from?.id?.toString();
        if (!userId) {
            logger.error("❌ ERROR: Invalid message structure in createOrUpdateSubscription. Missing user ID.", { msg });
            throw new Error("Invalid message structure: missing user ID.");
        }
        const chatId = msg.chat.id.toString();
        const username = (msg.from.username || '').toLowerCase();
        
        try {
            const now = new Date();
            const existingSubscription = await collection.findOne({ userId });
    
            if (existingSubscription) {
                return this.updateExistingSubscription(collection, existingSubscription, {
                    userId,
                    chatId, 
                    username, 
                    paymentId, 
                    amount, 
                    transactionHashes, 
                    now
                });
            }
    
            return this.createNewSubscription(collection, {
                userId,
                chatId, 
                username, 
                paymentId, 
                amount, 
                transactionHashes, 
                now
            });
        } catch (error) {
            logger.error(`Error with subscription for user ${userId}:`, error);
            throw error;
        }
    }

    static async createOrUpdateGroupSubscription(msg, groupName, paymentId, transactionData, customExpiryDate = null) {
        try {
            const collection = await this.getGroupCollection();
            const chatId = String(msg.chat.id);
            const userId = String(msg.from.id);
            const username = msg.from.username || 'unknown';
            
            // Récupérer l'abonnement existant ou créer un nouveau
            const existingSubscription = await collection.findOne({ chatId });
            
            // Gérer la date d'expiration
            let expiresAt;
            
            if (customExpiryDate) {
                // Utiliser la date d'expiration personnalisée si fournie (cas d'admin)
                expiresAt = new Date(customExpiryDate);
            } else if (existingSubscription && existingSubscription.expiresAt && new Date(existingSubscription.expiresAt) > new Date()) {
                // Prolonger un abonnement existant d'un mois
                expiresAt = new Date(existingSubscription.expiresAt);
                expiresAt.setMonth(expiresAt.getMonth() + 1);
            } else {
                // Nouvel abonnement ou abonnement expiré (1 mois à partir de maintenant)
                expiresAt = new Date();
                expiresAt.setMonth(expiresAt.getMonth() + 1);
            }
            
            // Préparer l'entrée de l'historique de paiement
            const paymentEntry = {
                paymentId,
                paymentDate: new Date(),
                paidByUserId: userId,
                paidByUsername: username,
                duration: customExpiryDate ? `Admin grant until ${expiresAt.toLocaleDateString()}` : '1 month',
                amount: 0, // Montant symbolique pour les octrois administratifs
                ...transactionData
            };
            
            // Mettre à jour ou créer l'abonnement
            const result = await collection.findOneAndUpdate(
                { chatId },
                {
                    $set: {
                        chatId,
                        groupName,
                        expiresAt,
                        lastUpdated: new Date(),
                        active: true
                    },
                    $push: { paymentHistory: paymentEntry }
                },
                { upsert: true, returnDocument: 'after' }
            );
            
            logger.info(`Group subscription updated for ${chatId}`, {
                groupName,
                expiresAt,
                paymentId,
                isAdmin: !!customExpiryDate
            });
            
            return result.value;
        } catch (error) {
            logger.error(`Error creating/updating group subscription for ${msg.chat.id}:`, error);
            throw error;
        }
    }

    static async updateExistingSubscription(collection, existingSubscription, data) {
        const { userId, chatId, username, paymentId, amount, transactionHashes, now } = data;
        const currentExpiryDate = new Date(existingSubscription.expiresAt);
        const newExpiryDate = new Date(
            Math.max(now.getTime(), currentExpiryDate.getTime()) + SUBSCRIPTION_TYPES.USER.duration
        );

        const paymentRecord = {
            userId,
            paymentId,
            duration: '1month',
            amount,
            paymentDate: now,
            paymentStatus: 'completed',
            transactionHash: transactionHashes.transactionHash,
            transferHash: transactionHashes.transferHash
        };

        const result = await collection.updateOne(
            { userId },
            {
                $set: {
                    chatId,
                    username,
                    active: true,
                    expiresAt: newExpiryDate,
                    lastUpdated: now
                },
                $push: {
                    paymentHistory: paymentRecord
                }
            }
        );

        logger.info(`Subscription updated for user ${userId} (${username})`);
        return result;
    }

    static async updateExistingGroupSubscription(collection, existingSubscription, data) {
        const { chatId, groupName, paidByUser, paymentId, amount, transactionHashes, now } = data;
        const currentExpiryDate = new Date(existingSubscription.expiresAt);
        const newExpiryDate = new Date(
            Math.max(now.getTime(), currentExpiryDate.getTime()) + SUBSCRIPTION_TYPES.GROUP.duration
        );

        const paymentRecord = {
            paymentId,
            duration: '1month',
            amount,
            paymentDate: now,
            paymentStatus: 'completed',
            transactionHash: transactionHashes.transactionHash,
            transferHash: transactionHashes.transferHash,
            paidByUserId: paidByUser.userId,
            paidByUsername: paidByUser.username
        };

        const result = await collection.updateOne(
            { chatId },
            {
                $set: {
                    groupName,
                    active: true,
                    expiresAt: newExpiryDate,
                    lastUpdated: now
                },
                $push: {
                    paymentHistory: paymentRecord
                }
            }
        );

        logger.info(`Group subscription updated for ${groupName} (${chatId})`);
        return result;
    }

    static async createNewSubscription(collection, data) {
        const { userId, chatId, username, paymentId, amount, transactionHashes, now } = data;

        const newSubscription = {
            userId,
            chatId,
            username,
            active: true,
            startDate: now,
            expiresAt: new Date(now.getTime() + SUBSCRIPTION_TYPES.USER.duration),
            lastUpdated: now,
            paymentHistory: [{
                userId,
                paymentId,
                duration: '1month',
                amount,
                paymentDate: now,
                paymentStatus: 'completed',
                transactionHash: transactionHashes.transactionHash,
                transferHash: transactionHashes.transferHash
            }]
        };

        const { error, value } = validateSubscription(newSubscription);
        if (error) throw error;

        const result = await collection.insertOne(value);
        logger.info(`New subscription created for user ${userId} (${username})`);
        return result;
    }

    static async createNewGroupSubscription(collection, data) {
        const { chatId, groupName, adminUserId, paidByUser, paymentId, amount, transactionHashes, now } = data;

        const newSubscription = {
            chatId,
            groupName,
            adminUserId,
            active: true,
            startDate: now,
            expiresAt: new Date(now.getTime() + SUBSCRIPTION_TYPES.GROUP.duration),
            lastUpdated: now,
            paymentHistory: [{
                paymentId,
                duration: '1month',
                amount,
                paymentDate: now,
                paymentStatus: 'completed',
                transactionHash: transactionHashes.transactionHash,
                transferHash: transactionHashes.transferHash,
                paidByUserId: paidByUser.userId,
                paidByUsername: paidByUser.username
            }]
        };

        const { error, value } = validateGroupSubscription(newSubscription);
        if (error) throw error;

        const result = await collection.insertOne(value);
        logger.info(`New group subscription created for ${groupName} (${chatId})`);
        return result;
    }

    static async getUserSubscription(userId) {
        const database = await getDatabase();
        const subscription = await database.collection("subscriptions").findOne({ userId });
        if (!subscription) return null;
    
        const isActive = subscription.expiresAt > new Date();
        
        // Update the database if the active status has changed
        if (subscription.active !== isActive) {
            try {
                await database.collection("subscriptions").updateOne(
                    { userId },
                    { 
                        $set: { 
                            active: isActive, 
                            lastUpdated: new Date() 
                        }
                    }
                );
                subscription.active = isActive;
                logger.info(`Updated subscription active status for user ${userId}: ${isActive}`);
            } catch (error) {
                logger.error(`Error updating subscription active status for user ${userId}:`, error);
                // Still return the subscription with the correct active status calculated
                subscription.active = isActive;
            }
        }
    
        return subscription;
    }    

    static async getSubscriptionByChatId(chatId) {
        const database = await getDatabase();
        const subscription = await database.collection("subscriptions").findOne({ chatId });
        if (!subscription) return null;

        subscription.active = subscription.expiresAt > new Date();
        return subscription;
    }

    static async getGroupSubscription(chatId) {
        const database = await getDatabase();
        const subscription = await database.collection("group_subscriptions").findOne({ chatId });
        if (!subscription) return null;
    
        const isActive = subscription.expiresAt > new Date();
        
        // Update the database if the active status has changed
        if (subscription.active !== isActive) {
            try {
                await database.collection("group_subscriptions").updateOne(
                    { chatId },
                    { 
                        $set: { 
                            active: isActive, 
                            lastUpdated: new Date() 
                        }
                    }
                );
                subscription.active = isActive;
                logger.info(`Updated group subscription active status for chat ${chatId}: ${isActive}`);
            } catch (error) {
                logger.error(`Error updating group subscription active status for chat ${chatId}:`, error);
                subscription.active = isActive;
            }
        }
    
        return subscription;
    }

    /**
     * Check if user has an active subscription by userId or username
     * @param {string} userId - User ID from Telegram
     * @param {string} username - Username from Telegram (optional)
     * @returns {Promise<boolean>} Whether the user has an active subscription
     */
    static async hasActiveSubscription(userId, username = null) {
        try {
            const database = await getDatabase();
            const collection = database.collection("subscriptions");
            const now = new Date();
            
            // First try to find by userId
            let subscription = await collection.findOne({
                userId: userId.toString(),
                expiresAt: { $gt: now }
            });
            
            // If not found and username is provided, try to find by username
            if (!subscription && username) {
                const normalizedUsername = username.toLowerCase();
                subscription = await collection.findOne({
                    username: normalizedUsername,
                    expiresAt: { $gt: now }
                });
            }
            
            return !!subscription;
        } catch (error) {
            logger.error(`Error checking subscription status for user ${userId}:`, error);
            return false;
        }
    }

    static async getSubscriptionList() {
        const database = await getDatabase();
        return await database.collection("subscriptions").find().toArray();
    }

    static async getGroupSubscriptionList() {
        const database = await getDatabase();
        return await database.collection("group_subscriptions").find().toArray();
    }

    static async removeSubscriptionByUsername(username) {
        if (!username) {
            logger.error("❌ ERROR: Username is required for removeSubscriptionByUsername");
            throw new Error("Username is required");
        }
    
        const normalizedUsername = username.toLowerCase();
        logger.debug("Attempting to remove subscription for username:", { username: normalizedUsername });
    
        try {
            const database = await getDatabase();
            const collection = database.collection("subscriptions");
    
            // Find the subscription first to check if it exists
            const subscription = await collection.findOne({ username: normalizedUsername });
            
            if (!subscription) {
                logger.warn(`No subscription found for username: ${normalizedUsername}`);
                return {
                    success: false,
                    message: "Subscription not found"
                };
            }
    
            // Remove the subscription
            const result = await collection.deleteOne({ username: normalizedUsername });
    
            if (result.deletedCount === 1) {
                logger.info(`Successfully removed subscription for username: ${normalizedUsername}`);
                return {
                    success: true,
                    message: "Subscription successfully removed",
                    userId: subscription.userId
                };
            } else {
                logger.error(`Failed to remove subscription for username: ${normalizedUsername}`);
                return {
                    success: false,
                    message: "Failed to remove subscription"
                };
            }
        } catch (error) {
            logger.error(`Error removing subscription for username ${normalizedUsername}:`, error);
            throw error;
        }
    }

    static async updateReferrerRewards(referrerUserId, subscriptionAmount) {
        try {
            const amount = Number(subscriptionAmount);
            if (isNaN(amount)) {
                throw new Error(`Invalid subscription amount: ${subscriptionAmount}`);
            }

            const rewardAmount = parseFloat((amount * 0.1).toFixed(9));
            
            logger.debug('Calculating referral reward:', {
                originalAmount: amount,
                rewardAmount: rewardAmount
            });

            const user = await UserService.getUserById(referrerUserId);
            if (!user) {
                throw new Error(`User not found: ${referrerUserId}`);
            }

            const currentUnclaimed = parseFloat(user.unclaimedRewards || 0);
            const currentTotal = parseFloat(user.totalRewards || 0);
            const newUnclaimed = parseFloat((currentUnclaimed + rewardAmount).toFixed(9));
            const newTotal = parseFloat((currentTotal + rewardAmount).toFixed(9));

            const result = await UserService.addUnclaimedRewards(referrerUserId, rewardAmount);

            logger.info(`Updated rewards for referrer ${referrerUserId}:`, {
                rewardAmount,
                newUnclaimed,
                newTotal
            });

            return result;
        } catch (error) {
            logger.error(`Error updating referrer rewards for ${referrerUserId}:`, error);
            throw error;
        }
    }
}

module.exports = SubscriptionService;