const logger = require('../../utils/logger');
const { validateSubscription, subscriptionDurations } = require('../../database/models/subscription');

class AccessControlDB {
    constructor(database) {
      this.db = database;
      this.usersCollection = this.db.collection('users');
      this.adminsCollection = this.db.collection('admins');
      this.subscriptionsCollection = this.db.collection('subscriptions');
      this.initialize();
    }

    async initialize() {
        try {
          // Index utilisateurs
          await this.usersCollection.createIndex({ username: 1 }, { unique: true });
          await this.usersCollection.createIndex({ chatId: 1 });
    
          // Index administrateurs
          await this.adminsCollection.createIndex({ username: 1 }, { unique: true });
          await this.adminsCollection.createIndex({ level: 1 }); // Pour différents niveaux d'admin si besoin
    
          // Index abonnements
          await this.subscriptionsCollection.createIndex({ userId: 1 });
          await this.subscriptionsCollection.createIndex({ username: 1 });
          await this.subscriptionsCollection.createIndex({ expiresAt: 1 });
          await this.subscriptionsCollection.createIndex({ type: 1 });
          
          logger.info('AccessControlDB initialized successfully');
        } catch (error) {
          logger.error('Error initializing AccessControlDB:', error);
        }
      }
  /**
   * Normalize un nom d'utilisateur en retirant le @ et convertissant en minuscules
   */
  normalizeUsername(username) {
    return username.replace(/^@/, '').toLowerCase();
  }

    /**
   * Vérifier si un utilisateur est admin
   */
    async isAdmin(username) {
        const normalizedUsername = this.normalizeUsername(username);
        return normalizedUsername === 'rengon0x';  // Votre username en minuscules
    }

  /**
   * Ajouter ou mettre à jour un utilisateur
   */
  async addUser(username, role = 'user', chatId = null) {
    const normalizedUsername = this.normalizeUsername(username);
    
    try {
      const userData = {
        username: normalizedUsername,
        role,
        chatId,
        lastUpdated: new Date(),
      };

      // Si l'utilisateur n'existe pas, ajouter firstSeen
      const existingUser = await this.usersCollection.findOne({ username: normalizedUsername });
      if (!existingUser) {
        userData.firstSeen = new Date();
      }

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

  /**
   * Supprimer un utilisateur
   */
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

  /**
   * Obtenir le rôle d'un utilisateur
   */
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

  /**
   * Vérifier si un utilisateur est VIP
   */
  async isVIP(username) {
    const role = await this.getUserRole(username);
    return role === 'vip' || role === 'admin';
  }

  /**
   * Vérifier si un utilisateur est autorisé
   */
  async isAllowed(username) {
    const normalizedUsername = this.normalizeUsername(username);
    
    // Si c'est l'admin, bypass la vérification d'abonnement
    if (normalizedUsername === 'rengon0x') {
      return true;
    }
  
    const hasActiveSub = await this.hasActiveSubscription(normalizedUsername);
    logger.info('user: ' + username, 'hasActiveSub: ' + hasActiveSub);
    return hasActiveSub;
  }  
  /**
   * Obtenir la liste de tous les utilisateurs
   */
  async getUsers(filter = {}) {
    try {
      return await this.usersCollection.find(filter).toArray();
    } catch (error) {
      logger.error('Error getting users:', error);
      return [];
    }
  }

  /**
   * Mettre à jour le chatId d'un utilisateur
   */
  async updateUserChatId(username, chatId) {
    const normalizedUsername = this.normalizeUsername(username);
    
    try {
      await this.usersCollection.updateOne(
        { username: normalizedUsername },
        { 
          $set: { 
            chatId,
            lastUpdated: new Date()
          }
        }
      );
      logger.info(`Updated chatId for user "${normalizedUsername}"`);
      return true;
    } catch (error) {
      logger.error(`Error updating chatId for user "${normalizedUsername}":`, error);
      return false;
    }
  }

    /**
   * Vérifier si un utilisateur a un abonnement actif
   */
    async hasActiveSubscription(username) {
        const normalizedUsername = this.normalizeUsername(username);
        try {
          const subscription = await this.subscriptionsCollection.findOne({
            username: normalizedUsername,
            active: true,
            paymentStatus: 'completed',
            expiresAt: { $gt: new Date() }
          });
          return !!subscription;
        } catch (error) {
          logger.error(`Error checking subscription for user "${normalizedUsername}":`, error);
          return false;
        }
      }
    
      /**
       * Créer un nouvel abonnement pour un utilisateur
       */
      async createSubscription(username, type, duration) {
        const normalizedUsername = this.normalizeUsername(username);
        
        try {
          // Vérifier si l'utilisateur existe
          const user = await this.usersCollection.findOne({ username: normalizedUsername });
          if (!user) {
            throw new Error(`User ${normalizedUsername} not found`);
          }
    
          const subscriptionData = {
            userId: user._id.toString(),
            username: normalizedUsername,
            type,
            duration,
            startDate: new Date(),
            expiresAt: new Date(Date.now() + subscriptionDurations[duration]),
            active: true,
            paymentStatus: 'pending',
            lastUpdated: new Date()
          };
    
          const { error, value } = validateSubscription(subscriptionData);
          if (error) {
            throw error;
          }
    
          await this.subscriptionsCollection.insertOne(value);
          logger.info(`Created subscription for user ${normalizedUsername}`);
          return value;
        } catch (error) {
          logger.error(`Error creating subscription for user "${normalizedUsername}":`, error);
          throw error;
        }
      }
    
      /**
       * Obtenir l'abonnement actif d'un utilisateur
       */
      async getActiveSubscription(username) {
        const normalizedUsername = this.normalizeUsername(username);
        try {
          return await this.subscriptionsCollection.findOne({
            username: normalizedUsername,
            active: true,
            expiresAt: { $gt: new Date() }
          });
        } catch (error) {
          logger.error(`Error getting subscription for user "${normalizedUsername}":`, error);
          return null;
        }
      }
    
      /**
       * Mettre à jour le status de paiement d'un abonnement
       */
      async updateSubscriptionPayment(subscriptionId, status) {
        try {
          const result = await this.subscriptionsCollection.updateOne(
            { _id: subscriptionId },
            { 
              $set: { 
                paymentStatus: status,
                lastUpdated: new Date()
              }
            }
          );
          logger.info(`Updated payment status for subscription ${subscriptionId} to ${status}`);
          return result.modifiedCount > 0;
        } catch (error) {
          logger.error(`Error updating subscription payment ${subscriptionId}:`, error);
          return false;
        }
      }
    }
    
module.exports = AccessControlDB;