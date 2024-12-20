const { MongoClient } = require('mongodb');
const config = require('../utils/config');
const logger = require('../utils/logger'); 
const { validateWallet } = require('./models/wallet');
const { validateSubscription } = require('./models/subscription.js');

let uri = config.MONGODB_URI || process.env.MONGODB_URI;

if (!uri) {
    logger.error('MONGODB_URI is not defined in environment variables or config file');
    throw new Error('MONGODB_URI is not defined in environment variables or config file');
}

uri = uri.trim();

if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
    logger.error(`Invalid MongoDB URI: ${uri}. URI must start with mongodb:// or mongodb+srv://`);
    throw new Error(`Invalid MongoDB URI: ${uri}. URI must start with mongodb:// or mongodb+srv://`);
}

const client = new MongoClient(uri, {
    connectTimeoutMS: 5000,
    socketTimeoutMS: 30000,
});

let db;

async function connectToDatabase() {
    if (!db) {
        try {
            await client.connect();
            // Utiliser une base de données dédiée pour le bot
            db = client.db("telegram_bot");
            logger.info("Connected to the database");
            
            client.on('close', async () => {
                logger.warn("Connection to database lost. Attempting to reconnect...");
                db = null;
                await connectToDatabase();
            });

            // Créer les index nécessaires
            const walletCollection = db.collection("wallets");
            const usersCollection = db.collection("users");
            const subscriptionsCollection = db.collection("subscriptions");

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
                subscriptionsCollection.createIndex({ type: 1 })
            ]);

            logger.info("Database indexes created successfully");
        } catch (error) {
            logger.error("Error connecting to the database:", error);
            throw error;
        }
    }
    return db;
}

async function getDatabase() {
    if (!db) {
        return await connectToDatabase();
    }
    return db;
}

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

// Fonction pour mettre à jour un abonnement
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
};