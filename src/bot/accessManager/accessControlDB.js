const logger = require('../../utils/logger');
const { validateSubscription, subscriptionDurations } = require('../../database/models/subscription');
const { validateGroupSubscription, groupSubscriptionDurations } = require('../../database/models/group_subscription');

class AccessControlDB {
    constructor(database) {
        if (!database) {
            throw new Error('Database instance is required');
        }
        this.db = database;
        this.usersCollection = this.db.collection('users');
        this.adminsCollection = this.db.collection('admins');
        this.subscriptionsCollection = this.db.collection('subscriptions');
        this.groupSubscriptionsCollection = this.db.collection('group_subscriptions');
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

    async createSubscription(username, duration, paymentData = {}) {
      const normalizedUsername = this.normalizeUsername(username);
      try {
          const paymentId = paymentData.paymentId || `payment_${Date.now()}`;
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
                      paymentStatus: paymentData.status || 'completed',
                      transactionHash: paymentData.transactionHash,
                      transferHash: paymentData.transferHash
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

    async updateSubscriptionPayment(username, paymentId, status, transactionHashes = {}) {
      const normalizedUsername = this.normalizeUsername(username);
      try {
          const result = await this.subscriptionsCollection.updateOne(
              { 
                  username: normalizedUsername,
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
  
          logger.info(`Updated payment status for ${normalizedUsername}, payment ${paymentId} to ${status} with hashes`, transactionHashes);
          return result.modifiedCount > 0;
          } catch (error) {
              logger.error(`Error updating payment for "${normalizedUsername}":`, error);
              return false;
          }
      }

        // Group Subscription Management
        async hasActiveGroupSubscription(groupId) {
          try {
              const subscription = await this.getGroupSubscription(groupId);
              return subscription?.active && 
                     subscription?.paymentHistory?.some(p => p.paymentStatus === 'completed') &&
                     subscription?.expiresAt > new Date();
          } catch (error) {
              logger.error(`Error checking group subscription for "${groupId}":`, error);
              return false;
          }
      }
  
      async createGroupSubscription(groupId, groupName, duration, payerInfo, paymentData = {}) {
        try {
            const paymentId = paymentData.paymentId || `group_payment_${Date.now()}`;
            const subscription = await this.groupSubscriptionsCollection.findOne({ groupId });
            
            // Log détaillé pour le débogage
            logger.debug('Group Subscription Creation - Input:', {
                groupId,
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
                    groupName, // Update group name in case it changed
                    active: true,
                    expiresAt: newExpiryDate,
                    lastUpdated: now,
                    paymentHistory: [...(subscription.paymentHistory || []), paymentRecord]
                };
    
                // Validate before update
                const { error, value } = validateGroupSubscription(updatedSubscription);
                
                // Log validation details
                if (error) {
                    logger.error('Group Subscription Validation Error (Update):', {
                        error: error.details,
                        subscription: updatedSubscription
                    });
                    throw error;
                }
    
                const result = await this.groupSubscriptionsCollection.updateOne(
                    { groupId },
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
    
                logger.info(`Group subscription updated for ${groupName} (${groupId})`, result);
            } else {
                // Create new subscription
                const now = new Date();
                const subscriptionData = {
                    groupId,
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
    
                // Validate before insert
                const { error, value } = validateGroupSubscription(subscriptionData);
                
                // Log validation details
                if (error) {
                    logger.error('Group Subscription Validation Error (Insert):', {
                        error: error.details,
                        subscription: subscriptionData
                    });
                    throw error;
                }
    
                const result = await this.groupSubscriptionsCollection.insertOne(value);
                
                logger.info(`New group subscription created for ${groupName} (${groupId})`, result);
            }
    
            return paymentId;
        } catch (error) {
            logger.error(`Error creating group subscription for "${groupId}":`, error);
            throw error;
        }
    }
  
      async getGroupSubscription(groupId) {
          try {
              const subscription = await this.groupSubscriptionsCollection.findOne({ groupId });
              if (!subscription) return null;
  
              subscription.active = subscription.expiresAt > new Date();
              return subscription;
          } catch (error) {
              logger.error(`Error getting group subscription for "${groupId}":`, error);
              return null;
          }
      }
  
      async updateGroupSubscriptionPayment(groupId, paymentId, status, payerInfo, transactionHashes = {}) {
          try {
              const result = await this.groupSubscriptionsCollection.updateOne(
                  { 
                      groupId,
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
  
              logger.info(`Updated group payment status for ${groupId}, payment ${paymentId} to ${status}`);
              return result.modifiedCount > 0;
          } catch (error) {
              logger.error(`Error updating group payment for "${groupId}":`, error);
              return false;
          }
      }
  

      async isAllowed(identifier, context = 'user') {
        try {
            // Pour les commandes admin
            if (context === 'admin') {
                const normalizedUsername = this.normalizeUsername(identifier);
                return normalizedUsername === 'rengon0x';
            }
    
            // Pour les groupes
            if (context === 'group') {
                return await this.hasActiveGroupSubscription(identifier);
            }
    
            // Pour les utilisateurs normaux
            return await this.hasActiveSubscription(this.normalizeUsername(identifier));
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