const logger = require('../../utils/logger');
const { validateSubscription, subscriptionDurations } = require('../../database/models/subscription');

class AccessControlDB {
    constructor(database) {
        this.db = database;
        this.usersCollection = this.db.collection('users');
        this.adminsCollection = this.db.collection('admins');
        this.subscriptionsCollection = this.db.collection('subscriptions');
    }

    // Pour la compatibilité avec le système existant
    async ensureIndexes() {
        logger.info('AccessControlDB is ready');
        return true;
    }

    normalizeUsername(username) {
        return username?.replace(/^@/, '').toLowerCase();
    }

    // User Management
    async isAdmin(username) {
        const normalizedUsername = this.normalizeUsername(username);
        return normalizedUsername === 'rengon0x';
    }

    async addUser(username, role = 'user', chatId = null) {
        const normalizedUsername = this.normalizeUsername(username);
        try {
            const userData = {
                username: normalizedUsername,
                role,
                chatId,
                lastUpdated: new Date(),
                firstSeen: new Date()
            };

            await this.usersCollection.updateOne(
                { username: normalizedUsername },
                { $set: userData },
                { upsert: true }
            );

            logger.info(`User "${normalizedUsername}" added/updated as "${role}"`);
            return true;
        } catch (error) {
            logger.error(`Error adding/updating user "${normalizedUsername}":`, error);
            return false;
        }
    }

    async removeUser(username) {
        const normalizedUsername = this.normalizeUsername(username);
        try {
            const result = await this.usersCollection.deleteOne({ username: normalizedUsername });
            logger.info(`User "${normalizedUsername}" removed (${result.deletedCount} document)`);
            return result.deletedCount > 0;
        } catch (error) {
            logger.error(`Error removing user "${normalizedUsername}":`, error);
            return false;
        }
    }

    async getUserRole(username) {
        const normalizedUsername = this.normalizeUsername(username);
        try {
            const user = await this.usersCollection.findOne({ username: normalizedUsername });
            return user ? user.role : 'guest';
        } catch (error) {
            logger.error(`Error getting role for user "${normalizedUsername}":`, error);
            return 'guest';
        }
    }

    async isVIP(username) {
        const role = await this.getUserRole(username);
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

    async updateUserChatId(username, chatId) {
        const normalizedUsername = this.normalizeUsername(username);
        try {
            await this.usersCollection.updateOne(
                { username: normalizedUsername },
                { $set: { chatId, lastUpdated: new Date() } }
            );
            logger.info(`Updated chatId for user "${normalizedUsername}"`);
            return true;
        } catch (error) {
            logger.error(`Error updating chatId for "${normalizedUsername}":`, error);
            return false;
        }
    }

    // Subscription Management
    async hasActiveSubscription(username) {
        const normalizedUsername = this.normalizeUsername(username);
        try {
            const subscription = await this.getSubscription(normalizedUsername);
            return subscription?.active && 
                   subscription?.paymentHistory?.some(p => p.paymentStatus === 'completed') &&
                   subscription?.expiresAt > new Date();
        } catch (error) {
            logger.error(`Error checking subscription for "${normalizedUsername}":`, error);
            return false;
        }
    }

    async createSubscription(username, duration) {
        const normalizedUsername = this.normalizeUsername(username);
        try {
            const paymentId = `payment_${Date.now()}`;
            const subscription = await this.subscriptionsCollection.findOne({ username: normalizedUsername });
            
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
                    paymentStatus: 'pending'
                };

                const updatedSubscription = {
                    ...subscription,
                    active: true,
                    expiresAt: newExpiryDate,
                    lastUpdated: now,
                    currentPaymentId: paymentId,
                    paymentHistory: [...(subscription.paymentHistory || []), paymentRecord]
                };

                // Validate before update
                const { error, value } = validateSubscription(updatedSubscription);
                if (error) throw error;

                await this.subscriptionsCollection.updateOne(
                    { username: normalizedUsername },
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
                    username: normalizedUsername,
                    startDate: now,
                    expiresAt: new Date(now.getTime() + subscriptionDurations[duration]),
                    active: true,
                    currentPaymentId: paymentId,
                    paymentHistory: [{
                        paymentId,
                        duration,
                        paymentDate: now,
                        paymentStatus: 'pending'
                    }],
                    lastUpdated: now
                };

                // Validate before insert
                const { error, value } = validateSubscription(subscriptionData);
                if (error) throw error;

                await this.subscriptionsCollection.insertOne(value);
            }

            return paymentId;
        } catch (error) {
            logger.error(`Error creating subscription for "${normalizedUsername}":`, error);
            throw error;
        }
    }

    async getSubscription(username) {
        const normalizedUsername = this.normalizeUsername(username);
        try {
            const subscription = await this.subscriptionsCollection.findOne({
                username: normalizedUsername
            });

            if (!subscription) return null;

            // Update active status
            subscription.active = subscription.expiresAt > new Date();
            
            return subscription;
        } catch (error) {
            logger.error(`Error getting subscription for "${normalizedUsername}":`, error);
            return null;
        }
    }

    async updateSubscriptionPayment(username, paymentId, status) {
        const normalizedUsername = this.normalizeUsername(username);
        try {
            const result = await this.subscriptionsCollection.updateOne(
                { 
                    username: normalizedUsername,
                    currentPaymentId: paymentId
                },
                {
                    $set: {
                        "paymentHistory.$[elem].paymentStatus": status,
                        lastUpdated: new Date()
                    }
                },
                {
                    arrayFilters: [{ "elem.paymentId": paymentId }]
                }
            );

            logger.info(`Updated payment status for ${normalizedUsername}, payment ${paymentId} to ${status}`);
            return result.modifiedCount > 0;
        } catch (error) {
            logger.error(`Error updating payment for "${normalizedUsername}":`, error);
            return false;
        }
    }

    async isAllowed(username) {
        const normalizedUsername = this.normalizeUsername(username);
        if (normalizedUsername === 'rengon0x') {
            return true;
        }
        const hasActiveSub = await this.hasActiveSubscription(normalizedUsername);
        logger.info(`Access check - user: ${username}, hasActiveSub: ${hasActiveSub}`);
        return hasActiveSub;
    }

    getDurationInMilliseconds(duration) {
        return subscriptionDurations[duration] || subscriptionDurations['1month'];
    }
}

module.exports = AccessControlDB;