// src/bot/accessManager/accessControlDB.js

const logger = require('../../utils/logger');
const { SubscriptionService, PaymentService, TokenVerificationService } = require('../../database');

class AccessControlDB {
   constructor(database, config) {
       if (!database) throw new Error('Database instance is required');
       if (!config) throw new Error('Config is required');
       
       this.db = database;
       this.config = config;
       this.usersCollection = this.db.collection('users');
       this.adminsCollection = this.db.collection('admins');
       this.subscriptionService = SubscriptionService;
       this.paymentService = PaymentService;
       this.tokenVerificationService = TokenVerificationService;
   }

   async ensureIndexes() {
       try {
           await this.usersCollection.createIndex({ chatId: 1 }, { unique: true });
           
           const indexes = await this.usersCollection.listIndexes().toArray();
           const usernameIndex = indexes.find(index => index.key.username === 1);
   
           if (usernameIndex?.unique) {
               await this.usersCollection.dropIndex("username_1");
               await this.usersCollection.createIndex({ username: 1 }, { unique: false });
           } else if (!usernameIndex) {
               await this.usersCollection.createIndex({ username: 1 }, { unique: false });
           }
           
           // Ensure indexes for tokenVerification and verifiedUsers collections
           const verifiedUsersCollection = this.db.collection('verifiedUsers');
           const tokenVerificationCollection = this.db.collection('tokenVerification');
           
           await verifiedUsersCollection.createIndex({ userId: 1 });
           await verifiedUsersCollection.createIndex({ walletAddress: 1 });
           await verifiedUsersCollection.createIndex({ isActive: 1 });
           await verifiedUsersCollection.createIndex({ userId: 1, isActive: 1 });
           
           await tokenVerificationCollection.createIndex({ sessionId: 1 }, { unique: true });
           await tokenVerificationCollection.createIndex({ userId: 1 });
           await tokenVerificationCollection.createIndex({ paymentAddress: 1 });
           await tokenVerificationCollection.createIndex({ status: 1 });
   
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

   async isAdmin(userId) {
        try {
            return this.config.adminIds.includes(Number(userId));
        } catch (error) {
            logger.error(`Error checking admin status for user "${userId}":`, error);
            return false;
        }
    }

   async getUsers(filter = {}) {
       try {
           return await this.usersCollection.find(filter).toArray();
       } catch (error) {
           logger.error('Error getting users:', error);
           return [];
       }
   }

    /**
     * Check if user has an active subscription by userId or username
     * Only checks by username if the subscription was created by an admin
     * @param {string} userId - User ID from Telegram
     * @param {string} username - Username from Telegram (optional)
     * @returns {Promise<boolean>} Whether the user has an active subscription
     */
    async hasActiveSubscription(userId, username = null) {
        if (!userId) return false;
        
        try {
            // First check by userId
            const subscriptionByUserId = await SubscriptionService.getUserSubscription(userId);
            
            if (subscriptionByUserId?.active) {
                return true;
            }
            
            // If not found and username is provided, check by username ONLY for admin-created subscriptions
            if (username) {
                const normalizedUsername = this.normalizeUsername(username);
                
                // Query subscriptions by username with admin payment history
                const subscriptionByUsername = await this.db.collection('subscriptions').findOne({
                    username: normalizedUsername,
                    expiresAt: { $gt: new Date() },
                    // Check for admin-created payments
                    $or: [
                        { "paymentHistory.paymentId": { $regex: /^admin_payment_/ } },
                        { "paymentHistory.adminGranted": true }
                    ]
                });
                
                return Boolean(subscriptionByUsername);
            }
            
            return false;
        } catch (error) {
            logger.error(`Error checking subscription for user "${userId}" / username "${username}":`, error);
            return false;
        }
    }

    /**
     * Check if user has token-verified status
     * @param {string} userId - User ID from Telegram
     * @returns {Promise<boolean>} Whether the user is token-verified
     */
    async hasTokenVerification(userId) {
        if (!userId) return false;
        
        try {
            if (!this.tokenVerificationService) {
                logger.warn('Token verification service not available');
                return false;
            }
            
            const verificationStatus = await this.tokenVerificationService.checkVerifiedStatus(userId);
            return verificationStatus.hasAccess;
            
        } catch (error) {
            logger.error(`Error checking token verification for user "${userId}":`, error);
            return false;
        }
    }

    async hasActiveGroupSubscription(chatId) {
        if (!chatId) return false;

        try {
            const subscription = await SubscriptionService.getGroupSubscription(chatId);
            return Boolean(subscription?.active);
        } catch (error) {
            logger.error(`Error checking group subscription for "${chatId}":`, error);
            return false;
        }
    }
    
   /**
    * Check if a user has access via any method (subscription, token verification, or admin)
    * @param {string} identifier - User ID or chat ID
    * @param {string} context - Access context: 'user', 'group', 'admin', or 'token'
    * @param {string} username - Username (optional, for subscription check)
    */
   async isAllowed(identifier, context = 'user', username = null) {
       try {
           // Admin access trumps all
           if (context === 'admin' || await this.isAdmin(identifier)) return true;
           
           // For group context, check group subscription
           if (context === 'group') return await this.hasActiveGroupSubscription(identifier);
           
           // For token context, check token verification
           if (context === 'token') return await this.hasTokenVerification(identifier);
           
           // First check subscription (traditional paid access)
           const hasSubscription = await this.hasActiveSubscription(identifier, username);
           if (hasSubscription) return true;
           
           // If no subscription, check token verification as fallback
           return await this.hasTokenVerification(identifier);
       } catch (error) {
           logger.error(`Error in isAllowed check for ${identifier} (${context}):`, error);
           return false;
       }
   }
}

module.exports = AccessControlDB;