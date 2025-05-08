const logger = require('../../utils/logger');
const { SubscriptionService, PaymentService } = require('../../database');

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
            logger.debug(`Checking if user ${userId} is an admin. Config adminIds: ${this.config.adminIds}`);
            
            // Convert to number for comparison
            const userIdNum = Number(userId);
            
            // Handle both array and comma-separated string formats
            if (Array.isArray(this.config.adminIds)) {
                return this.config.adminIds.includes(userIdNum);
            } else if (typeof this.config.adminIds === 'string') {
                // Parse comma-separated string of admin IDs
                const adminIdArray = this.config.adminIds.split(',').map(id => Number(id.trim()));
                logger.debug(`Parsed admin IDs: ${JSON.stringify(adminIdArray)}`);
                return adminIdArray.includes(userIdNum);
            } else if (typeof this.config.adminIds === 'number') {
                // Single admin ID as number
                return this.config.adminIds === userIdNum;
            }
            
            logger.warn(`Admin IDs not configured properly: ${this.config.adminIds}`);
            return false;
        } catch (error) {
            logger.error(`Error checking admin status for user "${userId}":`, error);
            logger.error(`Error details: ${error.message}`, { stack: error.stack });
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

   async hasActiveSubscription(userId) {
        if (!userId) return false;
        
        try {
            // Ici on appelle la méthode statique directement sur la classe
            const subscription = await SubscriptionService.getUserSubscription(userId);
            return Boolean(subscription?.active);
        } catch (error) {
            logger.error(`Error checking subscription for "${userId}":`, error);
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
   async isAllowed(identifier, context = 'user') {
       try {
           if (context === 'admin') return await this.isAdmin(identifier);
           if (context === 'group') return await this.hasActiveGroupSubscription(identifier);
           return await this.hasActiveSubscription(identifier);
       } catch (error) {
           logger.error(`Error in isAllowed check for ${identifier} (${context}):`, error);
           return false;
       }
   }
}

module.exports = AccessControlDB;