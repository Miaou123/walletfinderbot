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