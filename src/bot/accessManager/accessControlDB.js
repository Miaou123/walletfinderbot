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

    async hasActiveGroupSubscription(chatId) {
        if (!chatId) return false;

        try {
            // Pareil ici
            const subscription = await SubscriptionService.getGroupSubscription(chatId);
            return Boolean(subscription?.active);
        } catch (error) {
            logger.error(`Error checking group subscription for "${chatId}":`, error);
            return false;
        }
    }
    
    /**
     * Check if user has token verification and meets minimum token requirement
     * @param {string} userId - User ID from Telegram
     * @returns {Promise<boolean>} Whether the user has a verified wallet with enough tokens
     */
    async hasTokenVerification(userId) {
        if (!userId) return false;
        
        try {
            // Check verification status via the token verification service
            const verificationStatus = await this.tokenVerificationService.checkVerifiedStatus(userId);
            return verificationStatus.hasAccess;
        } catch (error) {
            logger.error(`Error checking token verification for user "${userId}":`, error);
            return false;
        }
    }
    
    /**
     * Get the token verification status with details
     * @param {string} userId - User ID from Telegram
     * @returns {Promise<Object>} - Verification status details
     */
    async getTokenVerificationStatus(userId) {
        if (!userId) return { hasAccess: false, reason: 'invalid_user_id' };
        
        try {
            return await this.tokenVerificationService.checkVerifiedStatus(userId);
        } catch (error) {
            logger.error(`Error getting token verification status for user "${userId}":`, error);
            return { hasAccess: false, reason: 'error', error: error.message };
        }
    }

   /**
    * Check if a user has access based on specified context
    * @param {string} identifier - User ID or group ID
    * @param {string} context - Access context: 'user', 'admin', 'group', or 'token'
    * @param {string} username - Username for subscription checks
    * @returns {Promise<boolean>} - Whether access is allowed
    */
   async isAllowed(identifier, context = 'user', username = null) {
       try {
           if (context === 'admin') return await this.isAdmin(identifier);
           if (context === 'group') return await this.hasActiveGroupSubscription(identifier);
           if (context === 'token') return await this.hasTokenVerification(identifier);
           
           // Default user check - either subscription or token verification is sufficient
           const hasSubscription = await this.hasActiveSubscription(identifier, username);
           
           // If configured to accept either subscription or token verification
           if (this.config.ALLOW_TOKEN_OR_SUBSCRIPTION) {
               const hasTokens = await this.hasTokenVerification(identifier);
               return hasSubscription || hasTokens;
           }
           
           return hasSubscription;
       } catch (error) {
           logger.error(`Error in isAllowed check for ${identifier} (${context}):`, error);
           return false;
       }
   }
}

module.exports = AccessControlDB;