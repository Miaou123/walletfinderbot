const { getDatabase } = require('../config/connection');
const { validateSubscription, subscriptionDuration, subscriptionPrice } = require('../models/subscription');
const { validateGroupSubscription, groupSubscriptionDuration, groupSubscriptionPrice } = require('../models/group_subscription');
const logger = require('../../utils/logger');

class SubscriptionService {
    static async createOrUpdateSubscription(chatId, username, paymentId, amount, transactionHashes = {}) {
        const database = await getDatabase();
        const collection = database.collection("subscriptions");
        
        // Convertir chatId en string si ce n'est pas déjà le cas
        const normalizedChatId = String(chatId);
        
        try {
            const now = new Date();
            const existingSubscription = await collection.findOne({ chatId: normalizedChatId });
    
            if (existingSubscription) {
                return this.updateExistingSubscription(collection, existingSubscription, {
                    chatId: normalizedChatId, 
                    username, 
                    paymentId, 
                    amount, 
                    transactionHashes, 
                    now
                });
            }
    
            return this.createNewSubscription(collection, {
                chatId: normalizedChatId, 
                username, 
                paymentId, 
                amount, 
                transactionHashes, 
                now
            });
        } catch (error) {
            logger.error(`Error with subscription for ${chatId}:`, error);
            throw error;
        }
    }

   static async createOrUpdateGroupSubscription(chatId, groupName, paidByUser, paymentId, transactionHashes = {}) {
       const database = await getDatabase();
       const collection = database.collection("group_subscriptions");
       
       try {
           const now = new Date();
           const existingSubscription = await collection.findOne({ chatId });

           if (existingSubscription) {
               return this.updateExistingGroupSubscription(collection, existingSubscription, {
                   chatId, groupName, paidByUser, paymentId, amount: groupSubscriptionPrice, transactionHashes, now
               });
           }

           return this.createNewGroupSubscription(collection, {
               chatId, groupName, paidByUser, paymentId, amount: groupSubscriptionPrice, transactionHashes, now
           });
       } catch (error) {
           logger.error(`Error with group subscription for ${chatId}:`, error);
           throw error;
       }
   }

   static async updateExistingSubscription(collection, existingSubscription, data) {
       const { chatId, username, paymentId, amount, transactionHashes, now } = data;
       const currentExpiryDate = new Date(existingSubscription.expiresAt);
       const newExpiryDate = new Date(
           Math.max(now.getTime(), currentExpiryDate.getTime()) + subscriptionDuration
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
           { chatId },
           {
               $set: {
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

       logger.info(`Subscription updated for user ${chatId} (${username})`);
       return result;
   }

   static async updateExistingGroupSubscription(collection, existingSubscription, data) {
       const { chatId, groupName, paidByUser, paymentId, amount, transactionHashes, now } = data;
       const currentExpiryDate = new Date(existingSubscription.expiresAt);
       const newExpiryDate = new Date(
           Math.max(now.getTime(), currentExpiryDate.getTime()) + groupSubscriptionDuration
       );

       const paymentRecord = {
           paymentId,
           duration: '1month',
           amount,
           paymentDate: now,
           paymentStatus: 'completed',
           transactionHash: transactionHashes.transactionHash,
           transferHash: transactionHashes.transferHash,
           paidByUserId: paidByUser.id,
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
       const { chatId, username, paymentId, amount, transactionHashes, now } = data;

       const newSubscription = {
           chatId,
           username,
           active: true,
           startDate: now,
           expiresAt: new Date(now.getTime() + subscriptionDuration),
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
       logger.info(`New subscription created for user ${chatId} (${username})`);
       return result;
   }

   static async createNewGroupSubscription(collection, data) {
       const { chatId, groupName, paidByUser, paymentId, amount, transactionHashes, now } = data;

       const newSubscription = {
           chatId,
           groupName,
           active: true,
           startDate: now,
           expiresAt: new Date(now.getTime() + groupSubscriptionDuration),
           lastUpdated: now,
           paymentHistory: [{
               paymentId,
               duration: '1month',
               amount,
               paymentDate: now,
               paymentStatus: 'completed',
               transactionHash: transactionHashes.transactionHash,
               transferHash: transactionHashes.transferHash,
               paidByUserId: paidByUser.id,
               paidByUsername: paidByUser.username
           }]
       };

       const { error, value } = validateGroupSubscription(newSubscription);
       if (error) throw error;

       const result = await collection.insertOne(value);
       logger.info(`New group subscription created for ${groupName} (${chatId})`);
       return result;
   }

   static async checkSubscription(chatId) {
       const database = await getDatabase();
       return await database.collection("subscriptions").findOne({
           chatId,
           active: true,
           expiresAt: { $gt: new Date() }
       });
   }

   static async checkGroupSubscription(chatId) {
        const database = await getDatabase();
        return await database.collection("group_subscriptions").findOne({
            chatId,
            active: true,
            expiresAt: { $gt: new Date() }
        });
    }

    static async getSubscription(chatId) {
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
}

module.exports = SubscriptionService;