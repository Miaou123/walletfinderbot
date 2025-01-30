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
        const userId = msg.from.id.toString();
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

    static async createOrUpdateGroupSubscription(msg, groupName, paymentId, transactionHashes = {}) {
        const database = await getDatabase();
        const collection = database.collection("group_subscriptions");
        const chatId = msg.chat.id.toString();
        const adminUserId = msg.from.id.toString();

        try {
            const now = new Date();
            const existingSubscription = await collection.findOne({ chatId });

            const paidByUser = {
                userId: adminUserId,
                username: (msg.from.username || '').toLowerCase()
            };

            if (existingSubscription) {
                return this.updateExistingGroupSubscription(collection, existingSubscription, {
                    chatId,
                    groupName,
                    paidByUser,
                    paymentId,
                    amount: SUBSCRIPTION_TYPES.GROUP.price,
                    transactionHashes,
                    now
                });
            }

            return this.createNewGroupSubscription(collection, {
                chatId,
                groupName,
                paidByUser,
                paymentId,
                amount: SUBSCRIPTION_TYPES.GROUP.price,
                transactionHashes,
                now
            });
        } catch (error) {
            logger.error(`Error with group subscription for ${chatId}:`, error);
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
        const { chatId, groupName, paidByUser, paymentId, amount, transactionHashes, now } = data;

        const newSubscription = {
            chatId,
            groupName,
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

        subscription.active = subscription.expiresAt > new Date();
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

        subscription.active = subscription.expiresAt > new Date();
        return subscription;
    }

    static async hasActiveSubscription(userId) {
        const subscription = await this.getUserSubscription(userId);
        return subscription && subscription.active;
    }

    static async getSubscriptionList() {
        const database = await getDatabase();
        return await database.collection("subscriptions").find().toArray();
    }

    static async getGroupSubscriptionList() {
        const database = await getDatabase();
        return await database.collection("group_subscriptions").find().toArray();
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