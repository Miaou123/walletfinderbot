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

   async isAdmin(chatId) {
       try {
           return this.config.adminIds.includes(Number(chatId));
       } catch (error) {
           logger.error(`Error checking admin status for "${chatId}":`, error);
           return false;
       }
   }

   async addUser(chatId, username, role = 'user') {
       const normalizedUsername = this.normalizeUsername(username);
       try {
           await this.usersCollection.updateOne(
               { chatId },
               { 
                   $set: {
                       chatId,
                       username: normalizedUsername,
                       role,
                       lastUpdated: new Date(),
                       firstSeen: new Date()
                   }
               },
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
           return user?.role || 'guest';
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
        if (!chatId) return false;
        
        try {
            const subscription = await this.subscriptionService.checkSubscription(chatId);
            return Boolean(subscription);
        } catch (error) {
            logger.error(`Error checking subscription for "${chatId}":`, error);
            return false;
        }
    }

    async hasActiveGroupSubscription(chatId) {
        if (!chatId) return false;

        try {
            const subscription = await this.subscriptionService.checkGroupSubscription(chatId);
            return Boolean(subscription);
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