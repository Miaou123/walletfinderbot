const { getDatabase } = require('../config/connection');
const { validateSubscription, subscriptionDuration, subscriptionPrice } = require('../models/subscription');
const { validateGroupSubscription, groupSubscriptionDuration, groupSubscriptionPrice } = require('../models/group_subscription');
const { SUBSCRIPTION_TYPES } = require('../config/subscriptionConfig'); // Assurez-vous d'importer cela
const UserService = require('./userService'); // Assurez-vous que le chemin est correct
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
                price *= REFERRAL_DISCOUNT; // 10% de réduction
            }
        }
    
        return price;
    }
    static async createOrUpdateSubscription(chatId, username, paymentId, amount, transactionHashes = {}) {
        const database = await getDatabase();
        const collection = database.collection("subscriptions");
        
        try {
            const now = new Date();
            const existingSubscription = await collection.findOne({ chatId: chatId });
    
            if (existingSubscription) {
                return this.updateExistingSubscription(collection, existingSubscription, {
                    chatId: chatId, 
                    username, 
                    paymentId, 
                    amount, 
                    transactionHashes, 
                    now
                });
            }
    
            return this.createNewSubscription(collection, {
                chatId: chatId, 
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

    static async getSubscriptionByUsername(username) {
        const database = await getDatabase();
        const normalizedUsername = username.replace(/^@/, '').toLowerCase();
    
        return await database.collection("subscriptions").findOne({ username: normalizedUsername });
    }

    static async getGroupSubscriptionByName(groupName) {
        const database = await getDatabase();
        return await database.collection("group_subscriptions").findOne({ groupName });
    }
    

    static async removeSubscriptionByUsername(username) {
        const database = await getDatabase();
        const result = await database.collection("subscriptions").deleteOne({ username });
        console.log("🗑️ Deleting subscription for:", username, "Result:", result);
        return result;
    }

    static async removeGroupSubscriptionByChatId(chatId) {
        const database = await getDatabase();
        const result = await database.collection("group_subscriptions").deleteOne({ chatId });
        console.log("🗑️ Deleting group subscription for:", chatId, "Result:", result);
        return result;
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

   static async hasActiveSubscription(chatId) {
    const subscription = await this.getSubscription(chatId);
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


    static async updateReferrerRewards(referrerChatId, subscriptionAmount) {
        const database = await getDatabase();
        const collection = database.collection("users");
        
        try {
            // S'assurer que le montant est un nombre
            const amount = Number(subscriptionAmount);
            if (isNaN(amount)) {
                throw new Error(`Invalid subscription amount: ${subscriptionAmount}`);
            }
    
            // Calculer la récompense (10% du montant de la souscription)
            const rewardAmount = parseFloat((amount * 0.1).toFixed(9)); // Éviter les problèmes de précision
            
            logger.debug('Calculating referral reward:', {
                originalAmount: amount,
                rewardAmount: rewardAmount
            });
    
            // Récupérer d'abord l'utilisateur pour vérifier les valeurs actuelles
            const user = await collection.findOne({ chatId: referrerChatId });
            if (!user) {
                throw new Error(`User not found: ${referrerChatId}`);
            }
    
            // Calculer les nouvelles valeurs
            const currentUnclaimed = parseFloat(user.unclaimedRewards || 0);
            const currentTotal = parseFloat(user.totalRewards || 0);
            const newUnclaimed = parseFloat((currentUnclaimed + rewardAmount).toFixed(9));
            const newTotal = parseFloat((currentTotal + rewardAmount).toFixed(9));
    
            // Mettre à jour avec les nouvelles valeurs
            const result = await collection.updateOne(
                { chatId: referrerChatId },
                { 
                    $set: { 
                        unclaimedRewards: newUnclaimed,
                        totalRewards: newTotal,
                        lastUpdated: new Date()
                    }
                }
            );
    
            logger.info(`Updated rewards for referrer ${referrerChatId}:`, {
                rewardAmount,
                newUnclaimed,
                newTotal
            });
    
            return result;
        } catch (error) {
            logger.error(`Error updating referrer rewards for ${referrerChatId}:`, error);
            throw error;
        }
    }

}

module.exports = SubscriptionService;