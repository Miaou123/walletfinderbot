const logger = require('../../utils/logger');
const { validateSubscription, subscriptionDurations } = require('../../database/models/subscription');
const { validateGroupSubscription, groupSubscriptionDurations } = require('../../database/models/group_subscription');


class AccessControlDB {
    constructor(database, config) {
        if (!database) {
            throw new Error('Database instance is required');
        }
        this.db = database;
        this.usersCollection = this.db.collection('users');
        this.adminsCollection = this.db.collection('admins');
        this.subscriptionsCollection = this.db.collection('subscriptions');
        this.groupSubscriptionsCollection = this.db.collection('group_subscriptions');
        this.config = config; 
    }

    async ensureIndexes() {
        try {

            await this.usersCollection.createIndex({ chatId: 1 }, { unique: true });
    
            const indexes = await this.usersCollection.listIndexes().toArray();
            const usernameIndex = indexes.find(index => index.key.username === 1);
    
            if (usernameIndex) {

                if (usernameIndex.unique) {
                    await this.usersCollection.dropIndex("username_1");
                    await this.usersCollection.createIndex({ username: 1 }, { unique: false });
                }
            } else {
                await this.usersCollection.createIndex({ username: 1 }, { unique: false });
            }
    
            await this.subscriptionsCollection.createIndex({ chatId: 1 }, { unique: true });
            await this.groupSubscriptionsCollection.createIndex({ chatId: 1 }, { unique: true });
    
            logger.info('AccessControlDB indexes ensured');
            return true;
        } catch (error) {
            logger.error('Error ensuring indexes:', error);
            throw error;
        }
    }

    normalizeUsername(username) {
        return username?.replace(/^@/, '').toLowerCase();
    }

    async isAdmin(chatId) {
        try {
            const userId = Number(chatId);

            return this.config.adminIds.includes(userId);
        } catch (error) {
            logger.error(`Error checking admin status for "${chatId}":`, error);
            return false;
        }
    }

    async addUser(chatId, username, role = 'user') {
        const normalizedUsername = this.normalizeUsername(username);
        try {
            const userData = {
                chatId,
                username: normalizedUsername,
                role,
                lastUpdated: new Date(),
                firstSeen: new Date()
            };

            await this.usersCollection.updateOne(
                { chatId },
                { $set: userData },
                { upsert: true }
            );

            logger.info(`User "${chatId}" (${normalizedUsername}) added/updated as "${role}"`);
            return true;
        } catch (error) {
            logger.error(`Error adding/updating user "${chatId}":`, error);
            return false;
        }
    }

    async removeUser(chatId) {
        try {
            const result = await this.usersCollection.deleteOne({ chatId });
            logger.info(`User "${chatId}" removed (${result.deletedCount} document)`);
            return result.deletedCount > 0;
        } catch (error) {
            logger.error(`Error removing user "${chatId}":`, error);
            return false;
        }
    }

    async getUserRole(chatId) {
        try {
            const user = await this.usersCollection.findOne({ chatId });
            return user ? user.role : 'guest';
        } catch (error) {
            logger.error(`Error getting role for user "${chatId}":`, error);
            return 'guest';
        }
    }

    async isVIP(chatId) {
        const role = await this.getUserRole(chatId);
        return role === 'vip' || role === 'admin';
    }

    async getUsers(filter = {}) {
        try {
            return await this.usersCollection.find(filter).toArray();
        } catch (error) {
            logger.error('Error getting users:', error);
            return [];
        }
    }

    async updateUsername(chatId, newUsername) {
        const normalizedUsername = this.normalizeUsername(newUsername);
        try {
            await this.usersCollection.updateOne(
                { chatId },
                { $set: { username: normalizedUsername, lastUpdated: new Date() } }
            );
            logger.info(`Updated username for user "${chatId}" to "${normalizedUsername}"`);
            return true;
        } catch (error) {
            logger.error(`Error updating username for "${chatId}":`, error);
            return false;
        }
    }

    async hasActiveSubscription(chatId) {
        try {
            const subscription = await this.getSubscription(chatId);
            return subscription?.active && 
                   subscription?.paymentHistory?.some(p => p.paymentStatus === 'completed') &&
                   subscription?.expiresAt > new Date();
        } catch (error) {
            logger.error(`Error checking subscription for "${chatId}":`, error);
            return false;
        }
    }

    async createSubscription(chatId, duration, paymentData = {}) {
        try {
            const paymentId = paymentData.paymentId || `payment_${Date.now()}`;
            const subscription = await this.subscriptionsCollection.findOne({ chatId });
            
            if (subscription) {
                // Extend existing subscription
                const currentExpiryDate = new Date(subscription.expiresAt);
                const now = new Date();
                const durationInMs = subscriptionDurations[duration];
                const newExpiryDate = new Date(
                    Math.max(now.getTime(), currentExpiryDate.getTime()) + durationInMs
                );

                const paymentRecord = {
                    paymentId,
                    duration,
                    paymentDate: now,
                    paymentStatus: paymentData.status || 'completed',
                    transactionHash: paymentData.transactionHash,
                    transferHash: paymentData.transferHash
                };

                const updatedSubscription = {
                    ...subscription,
                    active: true,
                    expiresAt: newExpiryDate,
                    lastUpdated: now,
                    currentPaymentId: paymentId,
                    paymentHistory: [...(subscription.paymentHistory || []), paymentRecord]
                };

                const { error, value } = validateSubscription(updatedSubscription);
                if (error) throw error;

                await this.subscriptionsCollection.updateOne(
                    { chatId },
                    {
                        $set: {
                            active: true,
                            expiresAt: newExpiryDate,
                            lastUpdated: now,
                            currentPaymentId: paymentId
                        },
                        $push: {
                            paymentHistory: paymentRecord
                        }
                    }
                );
            } else {
                // Create new subscription
                const now = new Date();
                const subscriptionData = {
                    chatId,
                    startDate: now,
                    expiresAt: new Date(now.getTime() + subscriptionDurations[duration]),
                    active: true,
                    currentPaymentId: paymentId,
                    paymentHistory: [{
                        paymentId,
                        duration,
                        paymentDate: now,
                        paymentStatus: paymentData.status || 'completed',
                        transactionHash: paymentData.transactionHash,
                        transferHash: paymentData.transferHash
                    }],
                    lastUpdated: now
                };

                const { error, value } = validateSubscription(subscriptionData);
                if (error) throw error;

                await this.subscriptionsCollection.insertOne(value);
            }

            return paymentId;
        } catch (error) {
            logger.error(`Error creating subscription for "${chatId}":`, error);
            throw error;
        }
    }

    async getSubscription(chatId) {
        try {
            const subscription = await this.subscriptionsCollection.findOne({ chatId });
            if (!subscription) return null;
            subscription.active = subscription.expiresAt > new Date();
            return subscription;
        } catch (error) {
            logger.error(`Error getting subscription for "${chatId}":`, error);
            return null;
        }
    }

    async updateSubscriptionPayment(chatId, paymentId, status, transactionHashes = {}) {
        try {
            const result = await this.subscriptionsCollection.updateOne(
                { 
                    chatId,
                    "paymentHistory.paymentId": paymentId
                },
                {
                    $set: {
                        lastUpdated: new Date(),
                        "paymentHistory.$[elem].paymentStatus": status,
                        "paymentHistory.$[elem].transactionHash": transactionHashes.transactionHash,
                        "paymentHistory.$[elem].transferHash": transactionHashes.transferHash
                    }
                },
                {
                    arrayFilters: [{ "elem.paymentId": paymentId }]
                }
            );

            logger.info(`Updated payment status for ${chatId}, payment ${paymentId} to ${status} with hashes`, transactionHashes);
            return result.modifiedCount > 0;
        } catch (error) {
            logger.error(`Error updating payment for "${chatId}":`, error);
            return false;
        }
    }

    async hasActiveGroupSubscription(chatId) {
        try {
            const subscription = await this.getGroupSubscription(chatId);
            return subscription?.active && 
                   subscription?.paymentHistory?.some(p => p.paymentStatus === 'completed') &&
                   subscription?.expiresAt > new Date();
        } catch (error) {
            logger.error(`Error checking group subscription for "${chatId}":`, error);
            return false;
        }
    }

    async createGroupSubscription(chatId, groupName, duration, payerInfo, paymentData = {}) {
        try {
            const paymentId = paymentData.paymentId || `group_payment_${Date.now()}`;
            const subscription = await this.groupSubscriptionsCollection.findOne({ chatId });
            
            logger.debug('Group Subscription Creation - Input:', {
                chatId,
                groupName,
                duration,
                payerInfo,
                paymentData
            });
            
            if (subscription) {
                // Extend existing subscription
                const currentExpiryDate = new Date(subscription.expiresAt);
                const now = new Date();
                const durationInMs = groupSubscriptionDurations[duration];
                const newExpiryDate = new Date(
                    Math.max(now.getTime(), currentExpiryDate.getTime()) + durationInMs
                );

                const paymentRecord = {
                    paymentId,
                    duration,
                    paymentDate: now,
                    paymentStatus: paymentData.status || 'completed',
                    amount: 2.0, // Fixed price for groups
                    transactionHash: paymentData.transactionHash,
                    transferHash: paymentData.transferHash,
                    paidByUserId: payerInfo.id,
                    paidByUsername: payerInfo.username
                };

                const updatedSubscription = {
                    ...subscription,
                    groupName,
                    active: true,
                    expiresAt: newExpiryDate,
                    lastUpdated: now,
                    paymentHistory: [...(subscription.paymentHistory || []), paymentRecord]
                };

                const { error, value } = validateGroupSubscription(updatedSubscription);
                
                if (error) {
                    logger.error('Group Subscription Validation Error (Update):', {
                        error: error.details,
                        subscription: updatedSubscription
                    });
                    throw error;
                }

                const result = await this.groupSubscriptionsCollection.updateOne(
                    { chatId },
                    {
                        $set: {
                            active: true,
                            groupName,
                            expiresAt: newExpiryDate,
                            lastUpdated: now
                        },
                        $push: {
                            paymentHistory: paymentRecord
                        }
                    }
                );

                logger.info(`Group subscription updated for ${groupName} (${chatId})`, result);
            } else {
                // Create new subscription
                const now = new Date();
                const subscriptionData = {
                    chatId,
                    groupName,
                    startDate: now,
                    expiresAt: new Date(now.getTime() + groupSubscriptionDurations[duration]),
                    active: true,
                    paymentHistory: [{
                        paymentId,
                        duration,
                        paymentDate: now,
                        paymentStatus: paymentData.status || 'completed',
                        amount: 2.0,
                        transactionHash: paymentData.transactionHash,
                        transferHash: paymentData.transferHash,
                        paidByUserId: payerInfo.id,
                        paidByUsername: payerInfo.username
                    }],
                    lastUpdated: now
                };

                const { error, value } = validateGroupSubscription(subscriptionData);
                
                if (error) {
                    logger.error('Group Subscription Validation Error (Insert):', {
                        error: error.details,
                        subscription: subscriptionData
                    });
                    throw error;
                }

                const result = await this.groupSubscriptionsCollection.insertOne(value);
                
                logger.info(`New group subscription created for ${groupName} (${chatId})`, result);
            }

            return paymentId;
        } catch (error) {
            logger.error(`Error creating group subscription for "${chatId}":`, error);
            throw error;
        }
    }

    async getGroupSubscription(chatId) {
        try {
            const subscription = await this.groupSubscriptionsCollection.findOne({ chatId });
            if (!subscription) return null;

            subscription.active = subscription.expiresAt > new Date();
            return subscription;
        } catch (error) {
            logger.error(`Error getting group subscription for "${chatId}":`, error);
            return null;
        }
    }

    async updateGroupSubscriptionPayment(chatId, paymentId, status, payerInfo, transactionHashes = {}) {
        try {
            const result = await this.groupSubscriptionsCollection.updateOne(
                { 
                    chatId,
                    "paymentHistory.paymentId": paymentId
                },
                {
                    $set: {
                        lastUpdated: new Date(),
                        "paymentHistory.$[elem].paymentStatus": status,
                        "paymentHistory.$[elem].transactionHash": transactionHashes.transactionHash,
                        "paymentHistory.$[elem].transferHash": transactionHashes.transferHash,
                        "paymentHistory.$[elem].paidByUserId": payerInfo.id,
                        "paymentHistory.$[elem].paidByUsername": payerInfo.username
                    }
                },
                {
                    arrayFilters: [{ "elem.paymentId": paymentId }]
                }
            );

            logger.info(`Updated group payment status for ${chatId}, payment ${paymentId} to ${status}`);
            return result.modifiedCount > 0;
        } catch (error) {
            logger.error(`Error updating group payment for "${chatId}":`, error);
            return false;
        }
    }

    async isAllowed(identifier, context = 'user') {
        try {
            if (context === 'admin') {
                return await this.isAdmin(identifier);
            }

            if (context === 'group') {
                return await this.hasActiveGroupSubscription(identifier);
            }

            return await this.hasActiveSubscription(identifier);
        } catch (error) {
            logger.error(`Error in isAllowed check for ${identifier} (${context}):`, error);
            return false;
        }
    }

    getDurationInMilliseconds(duration) {
        return subscriptionDurations[duration] || subscriptionDurations['1month'];
    }
}

module.exports = AccessControlDB;