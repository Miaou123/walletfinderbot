const { MongoClient } = require('mongodb');
const config = require('../utils/config');
const logger = require('../utils/logger'); 
const { validateWallet } = require('./models/wallet');
const { validateSubscription } = require('./models/subscription.js');

let mongoClient = null;
let db = null;
const uri = config.MONGODB_URI?.trim() || process.env.MONGODB_URI?.trim();

if (!uri) {
   throw new Error('MONGODB_URI is not defined');
}

if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
   throw new Error(`Invalid MongoDB URI: ${uri}`);
}

// Création du client MongoDB avec gestion des listeners
if (!mongoClient) {
   mongoClient = new MongoClient(uri, {
       connectTimeoutMS: 5000,
       socketTimeoutMS: 30000,
   });
   mongoClient.setMaxListeners(20);
   
   mongoClient.on('close', async () => {
       logger.warn("Connection to database lost. Attempting to reconnect...");
       db = null;
       // Tentative de reconnexion
       try {
           await connectToDatabase();
       } catch (error) {
           logger.error("Reconnection attempt failed:", error);
       }
   });
}

/**
 * Fonction pour connecter à la base de données
 * @returns {Promise<void>}
 */
async function connectToDatabase() {
    if (!db) {
        try {
            await mongoClient.connect();
            // Utiliser une base de données dédiée pour le bot
            db = mongoClient.db("telegram_bot");
            logger.info("Connected to the database");
            
            // Créer les index nécessaires
            const walletCollection = db.collection("wallets");
            const usersCollection = db.collection("users");
            const subscriptionsCollection = db.collection("subscriptions");
            const paymentAddressesCollection = db.collection("payment_addresses");

            await Promise.all([
                // Index pour les wallets
                walletCollection.createIndex({ address: 1 }, { unique: true }),
                
                // Index pour les utilisateurs
                usersCollection.createIndex({ username: 1 }, { unique: true }),
                usersCollection.createIndex({ chatId: 1 }),
                usersCollection.createIndex({ role: 1 }),
                
                // Index pour les abonnements
                subscriptionsCollection.createIndex({ userId: 1 }),
                subscriptionsCollection.createIndex({ expiresAt: 1 }),
                subscriptionsCollection.createIndex({ type: 1 }),

                // Index pour les adresses de paiement
                paymentAddressesCollection.createIndex({ sessionId: 1 }, { unique: true }),
                paymentAddressesCollection.createIndex({ username: 1 }),
                paymentAddressesCollection.createIndex({ expires: 1 }),
                paymentAddressesCollection.createIndex({ status: 1 }),
                paymentAddressesCollection.createIndex({ publicKey: 1 }, { unique: true })
            ]);

            logger.info("Database indexes created successfully");
        } catch (error) {
            logger.error("Error connecting to the database:", error);
            throw error;
        }
    }
}

/**
 * Obtient la base de données connectée
 * @returns {Promise<Object>} La base de données MongoDB
 */
async function getDatabase() {
    if (!db) {
        await connectToDatabase();
    }
    return db;
}

/**
 * Sauvegarde un portefeuille intéressant dans la base de données
 * @param {string} address - L'adresse du portefeuille
 * @param {Object} walletData - Les données du portefeuille
 * @returns {Promise<Object|null>} Le résultat de l'opération ou null si ignoré
 */
async function saveInterestingWallet(address, walletData) {
    const database = await getDatabase();
    const collection = database.collection("wallets");
    
    const existingWallet = await collection.findOne({ address });
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    
    if (existingWallet && existingWallet.refresh_date > fifteenMinutesAgo) {
        logger.debug(`Wallet ${address} was refreshed recently. Skipping update.`);
        return null;
    }

    const walletToSave = {
        address,
        ...walletData,
        refresh_date: new Date(),
        lastUpdated: new Date()
    };

    try {
        const { error, value: validatedWallet } = validateWallet(walletToSave);
        if (error) {
            logger.warn(`Validation warning for wallet ${address}: ${error.details[0].message}`, {
                wallet: address,
                error: error.details
            });
        }

        const result = await collection.updateOne(
            { address: address },
            { $set: validatedWallet || walletToSave },
            { upsert: true }
        );
        
        if (result.upsertedCount > 0) {
            logger.info(`New wallet ${address} saved to database`);
        } else if (result.modifiedCount > 0) {
            logger.info(`Existing wallet ${address} updated in database`);
        } else {
            logger.debug(`Wallet ${address} already up to date in database`);
        }
        
        return result;
    } catch (error) {
        logger.error(`Error saving wallet ${address} to database:`, error, {
            wallet: address,
            error: error
        });
        return null;
    }
}

// Fonction pour créer un abonnement
async function createSubscription(userId, username, type, duration) {
    const database = await getDatabase();
    const collection = database.collection("subscriptions");
    
    // Création de l'objet subscription
    const subscriptionData = {
        userId,
        username,
        type,
        duration,
        startDate: new Date(),
        expiresAt: new Date(Date.now() + subscriptionDurations[duration]),
        active: true,
        paymentStatus: 'pending',
        lastUpdated: new Date()
    };

    // Validation des données
    const { error, value: validatedSubscription } = validateSubscription(subscriptionData);
    
    if (error) {
        logger.error(`Validation error for subscription: ${error.details[0].message}`, {
            userId,
            error: error.details
        });
        throw error;
    }

    try {
        const result = await collection.insertOne(validatedSubscription);
        logger.info(`New subscription created for user ${userId} of type ${type}`);
        return { ...validatedSubscription, _id: result.insertedId };
    } catch (error) {
        logger.error(`Error creating subscription for user ${userId}:`, error);
        throw error;
    }
}

// Fonction pour vérifier un abonnement
async function checkSubscription(userId) {
    const database = await getDatabase();
    const collection = database.collection("subscriptions");
    
    try {
        const subscription = await collection.findOne({
            userId,
            active: true,
            paymentStatus: 'completed',
            expiresAt: { $gt: new Date() }
        });
        
        return subscription;
    } catch (error) {
        logger.error(`Error checking subscription for user ${userId}:`, error);
        return null;
    }
}

// Fonction pour mettre à jour un abonnement
async function updateSubscription(subscriptionId, updateData) {
    const database = await getDatabase();
    const collection = database.collection("subscriptions");
    
    // Ajouter lastUpdated au données de mise à jour
    const dataToUpdate = {
        ...updateData,
        lastUpdated: new Date()
    };

    // Validation des données de mise à jour
    const currentSubscription = await collection.findOne({ _id: subscriptionId });
    if (!currentSubscription) {
        throw new Error('Subscription not found');
    }

    const updatedSubscription = {
        ...currentSubscription,
        ...dataToUpdate
    };

    const { error, value: validatedUpdate } = validateSubscription(updatedSubscription);
    
    if (error) {
        logger.error(`Validation error for subscription update: ${error.details[0].message}`);
        throw error;
    }

    try {
        const result = await collection.updateOne(
            { _id: subscriptionId },
            { $set: dataToUpdate }
        );
        
        return result.modifiedCount > 0;
    } catch (error) {
        logger.error(`Error updating subscription ${subscriptionId}:`, error);
        return false;
    }
}

// Fonction pour obtenir les abonnements d'un utilisateur
async function getUserSubscriptions(userId) {
    const database = await getDatabase();
    const collection = database.collection("subscriptions");
    
    try {
        return await collection.find({ 
            userId,
            active: true
        }).toArray();
    } catch (error) {
        logger.error(`Error getting subscriptions for user ${userId}:`, error);
        return [];
    }
}

// Fonction pour compléter le paiement d'un abonnement
async function completeSubscriptionPayment(subscriptionId) {
    const database = await getDatabase();
    const collection = database.collection("subscriptions");
    
    try {
        const result = await collection.updateOne(
            { _id: subscriptionId },
            { 
                $set: {
                    paymentStatus: 'completed',
                    lastUpdated: new Date()
                }
            }
        );
        
        return result.modifiedCount > 0;
    } catch (error) {
        logger.error(`Error completing payment for subscription ${subscriptionId}:`, error);
        return false;
    }
}

// Fonction pour ajouter un administrateur
async function addAdmin(username, addedBy = 'system') {
    const database = await getDatabase();
    const collection = database.collection("admins");
    
    const adminData = {
        username: username.toLowerCase().replace(/^@/, ''),
        addedBy,
        addedAt: new Date(),
        lastUpdated: new Date(),
        level: 'admin'
    };

    const { error, value: validatedAdmin } = validateAdmin(adminData);
    if (error) {
        logger.error(`Validation error for admin: ${error.details[0].message}`);
        throw error;
    }

    try {
        const result = await collection.updateOne(
            { username: adminData.username },
            { $set: validatedAdmin },
            { upsert: true }
        );
        
        if (result.upsertedCount > 0) {
            logger.info(`New admin ${username} added by ${addedBy}`);
        } else if (result.modifiedCount > 0) {
            logger.info(`Admin ${username} updated by ${addedBy}`);
        }
        
        return result;
    } catch (error) {
        logger.error(`Error adding/updating admin ${username}:`, error);
        throw error;
    }
}

// Fonctions de payment et de sauvegarde des données temporaires

async function savePaymentAddress(paymentData) {
    const database = await getDatabase();
    const collection = database.collection("payment_addresses");
    
    const paymentAddressData = {
        sessionId: paymentData.sessionId,
        username: paymentData.username,
        publicKey: paymentData.paymentAddress,
        privateKey: Buffer.from(paymentData.privateKey).toString('base64'), // Encodage en base64 pour stockage sécurisé
        amount: paymentData.amount,
        duration: paymentData.duration,
        created: paymentData.created,
        expires: paymentData.expires,
        status: paymentData.status,
        lastUpdated: new Date()
    };

    try {
        const result = await collection.insertOne(paymentAddressData);
        logger.info(`Payment address saved for session ${paymentData.sessionId}`);
        return result;
    } catch (error) {
        logger.error(`Error saving payment address for session ${paymentData.sessionId}:`, error);
        throw error;
    }
}

async function getPaymentAddress(sessionId) {
    const database = await getDatabase();
    const collection = database.collection("payment_addresses");
    
    try {
        return await collection.findOne({ sessionId });
    } catch (error) {
        logger.error(`Error retrieving payment address for session ${sessionId}:`, error);
        return null;
    }
}

async function updatePaymentAddressStatus(sessionId, status) {
    const database = await getDatabase();
    const collection = database.collection("payment_addresses");
    
    try {
        const result = await collection.updateOne(
            { sessionId },
            { 
                $set: {
                    status,
                    lastUpdated: new Date()
                }
            }
        );
        
        if (result.modifiedCount > 0) {
            logger.info(`Payment address status updated for session ${sessionId}: ${status}`);
        }
        return result.modifiedCount > 0;
    } catch (error) {
        logger.error(`Error updating payment address status for session ${sessionId}:`, error);
        return false;
    }
}

async function cleanupExpiredPaymentAddresses() {
    const database = await getDatabase();
    const collection = database.collection("payment_addresses");
    
    try {
        const result = await collection.updateMany(
            {
                expires: { $lt: new Date() },
                status: 'pending'
            },
            {
                $set: {
                    status: 'expired',
                    lastUpdated: new Date()
                }
            }
        );
        
        if (result.modifiedCount > 0) {
            logger.info(`Marked ${result.modifiedCount} expired payment addresses`);
        }
        return result.modifiedCount;
    } catch (error) {
        logger.error('Error cleaning up expired payment addresses:', error);
        return 0;
    }
}

process.on('SIGINT', async () => {
   if (mongoClient) {
       await mongoClient.close();
   }
   process.exit(0);
});

module.exports = { 
    connectToDatabase, 
    getDatabase, 
    saveInterestingWallet,
    createSubscription,
    checkSubscription,
    updateSubscription,
    getUserSubscriptions,
    completeSubscriptionPayment,
    addAdmin,
    savePaymentAddress,
    getPaymentAddress,
    updatePaymentAddressStatus,
    cleanupExpiredPaymentAddresses
};
