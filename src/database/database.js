const { MongoClient } = require('mongodb');
const config = require('../utils/config');
const logger = require('../utils/logger'); 
const { validateWallet } = require('./models/wallet');
const { validateSubscription } = require('./models/subscription.js');
const { validateGroupSubscription } = require('./models/group_subscription');

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

async function updateIndexes(db) {
    try {
        logger.info('Starting index verification...');
        
        // Définir les index requis pour chaque collection
        const collections = {
            wallets: {
                collection: db.collection("wallets"),
                indexes: [
                    { key: { address: 1 }, options: { unique: true } }
                ]
            },
            users: {
                collection: db.collection("users"),
                indexes: [
                    { key: { username: 1 }, options: { unique: true } },
                    { key: { chatId: 1 }, options: {} },
                    { key: { role: 1 }, options: {} }
                ]
            },
            subscriptions: {
                collection: db.collection("subscriptions"),
                indexes: [
                    { key: { username: 1 }, options: { unique: true } },
                    { key: { expiresAt: 1 }, options: {} },
                    { key: { active: 1 }, options: {} }
                ]
            },
            group_subscriptions: {
                collection: db.collection("group_subscriptions"),
                indexes: [
                    { key: { groupId: 1 }, options: { unique: true } },
                    { key: { expiresAt: 1 }, options: {} },
                    { key: { active: 1 }, options: {} }
                ]
            },
            payment_addresses: {
                collection: db.collection("payment_addresses"),
                indexes: [
                    { key: { sessionId: 1 }, options: { unique: true } },
                    { key: { username: 1 }, options: {} },
                    { key: { expires: 1 }, options: {} },
                    { key: { publicKey: 1 }, options: { unique: true } }
                ]
            }
        };

        // Créer les collections si elles n'existent pas
        for (const [collectionName, config] of Object.entries(collections)) {
            try {
                await db.createCollection(collectionName);
                logger.info(`Collection ${collectionName} created or already exists`);
            } catch (error) {
                // Ignore l'erreur si la collection existe déjà
                if (error.code !== 48) { // 48 = collection already exists
                    logger.error(`Error creating collection ${collectionName}:`, error);
                }
            }
        }

        // Traiter chaque collection
        for (const [collectionName, config] of Object.entries(collections)) {
            logger.info(`Processing indexes for ${collectionName}...`);
            
            try {
                // Obtenir les index existants
                const existingIndexes = await config.collection.listIndexes().toArray();
                
                // Pour chaque index requis
                for (const indexDef of config.indexes) {
                    const keyString = Object.entries(indexDef.key)
                        .map(([k, v]) => `${k}_${v}`)
                        .join('_');
                    
                    // Vérifier si un index similaire existe
                    const existingIndex = existingIndexes.find(idx => 
                        JSON.stringify(idx.key) === JSON.stringify(indexDef.key)
                    );

                    if (!existingIndex) {
                        logger.info(`Creating index ${keyString} for ${collectionName}`);
                        await config.collection.createIndex(
                            indexDef.key,
                            indexDef.options
                        );
                    } else if (
                        existingIndex.unique !== indexDef.options.unique && 
                        indexDef.options.unique !== undefined
                    ) {
                        // S'il existe mais avec des options différentes
                        logger.info(`Recreating index ${keyString} for ${collectionName}`);
                        await config.collection.dropIndex(existingIndex.name);
                        await config.collection.createIndex(
                            indexDef.key,
                            indexDef.options
                        );
                    }
                }
            } catch (error) {
                logger.error(`Error processing indexes for ${collectionName}:`, error);
                // Continue with next collection
            }
        }

        logger.info('Index verification completed successfully');
    } catch (error) {
        logger.error('Error during index verification:', error);
        // Ne pas faire remonter l'erreur pour ne pas bloquer le démarrage
    }
}

/**
 * Fonction pour connecter à la base de données
 * @returns {Promise<void>}
 */
async function connectToDatabase() {
    if (!db) {
        try {
            await mongoClient.connect();
            db = mongoClient.db("telegram_bot");
            logger.info("Connected to the database");
            
            // Vérifier et mettre à jour les index si nécessaire
            await updateIndexes(db);
            
        } catch (error) {
            logger.error("Error connecting to the database:", error);
            throw error;
        }
    }
    return db;
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
async function createOrUpdateSubscription(username, duration, paymentId, amount, transactionHashes = {}) {
    const database = await getDatabase();
    const collection = database.collection("subscriptions");
    
    try {
        const now = new Date();
        const durationMs = subscriptionDurations[duration];
        
        // Rechercher un abonnement existant
        const existingSubscription = await collection.findOne({ username });
        
        if (existingSubscription) {
            // Calculer la nouvelle date d'expiration
            const currentExpiryDate = new Date(existingSubscription.expiresAt);
            const newExpiryDate = new Date(
                Math.max(now.getTime(), currentExpiryDate.getTime()) + durationMs
            );

            // Nouveau paiement à ajouter à l'historique
            const paymentRecord = {
                paymentId,
                duration,
                amount,
                paymentDate: now,
                paymentStatus: 'completed',
                transactionHash: transactionHashes.transactionHash, // Ajout du hash de la transaction
                transferHash: transactionHashes.transferHash       // Ajout du hash du transfert
            };

            // Mettre à jour l'abonnement existant
            const result = await collection.updateOne(
                { username },
                {
                    $set: {
                        active: true,
                        expiresAt: newExpiryDate,
                        lastUpdated: now
                    },
                    $push: {
                        paymentHistory: paymentRecord
                    }
                }
            );

            logger.info(`Subscription updated for user ${username}`);
            return result;
        } else {
            // Créer un nouvel abonnement
            const newSubscription = {
                username,
                active: true,
                startDate: now,
                expiresAt: new Date(now.getTime() + durationMs),
                lastUpdated: now,
                paymentHistory: [{
                    paymentId,
                    duration,
                    amount,
                    paymentDate: now,
                    paymentStatus: 'completed',
                    transactionHash: transactionHashes.transactionHash, // Ajout du hash de la transaction
                    transferHash: transactionHashes.transferHash       // Ajout du hash du transfert
                }]
            };

            const { error, value } = validateSubscription(newSubscription);
            if (error) throw error;

            const result = await collection.insertOne(value);
            logger.info(`New subscription created for user ${username}`);
            return result;
        }
    } catch (error) {
        logger.error(`Error creating/updating subscription for user ${username}:`, error);
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

// Fonction pour obtenir les abonnements d'un utilisateur
async function getSubscription(username) {
    const database = await getDatabase();
    const collection = database.collection("subscriptions");
    
    try {
        const subscription = await collection.findOne({ username });
        if (!subscription) return null;

        subscription.active = subscription.expiresAt > new Date();
        return subscription;
    } catch (error) {
        logger.error(`Error getting subscription for user ${username}:`, error);
        return null;
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

// Fonctions pour les groupes
async function createOrUpdateGroupSubscription(groupId, groupName, duration, paidByUser, paymentId, amount, transactionHashes = {}) {
    const database = await getDatabase();
    const collection = database.collection("group_subscriptions");
    
    try {
        const now = new Date();
        const durationMs = groupSubscriptionDurations[duration];
        
        // Rechercher un abonnement existant
        const existingSubscription = await collection.findOne({ groupId });
        
        if (existingSubscription) {
            // Calculer la nouvelle date d'expiration
            const currentExpiryDate = new Date(existingSubscription.expiresAt);
            const newExpiryDate = new Date(
                Math.max(now.getTime(), currentExpiryDate.getTime()) + durationMs
            );

            const paymentRecord = {
                paymentId,
                duration,
                amount,
                paymentDate: now,
                paymentStatus: 'completed',
                transactionHash: transactionHashes.transactionHash,
                transferHash: transactionHashes.transferHash,
                paidByUserId: paidByUser.id,
                paidByUsername: paidByUser.username
            };

            const result = await collection.updateOne(
                { groupId },
                {
                    $set: {
                        groupName, // Mettre à jour le nom du groupe au cas où il a changé
                        active: true,
                        expiresAt: newExpiryDate,
                        lastUpdated: now
                    },
                    $push: {
                        paymentHistory: paymentRecord
                    }
                }
            );

            logger.info(`Group subscription updated for ${groupName} (${groupId})`);
            return result;
        } else {
            // Créer un nouvel abonnement
            const newSubscription = {
                groupId,
                groupName,
                active: true,
                startDate: now,
                expiresAt: new Date(now.getTime() + durationMs),
                lastUpdated: now,
                paymentHistory: [{
                    paymentId,
                    duration,
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
            logger.info(`New group subscription created for ${groupName} (${groupId})`);
            return result;
        }
    } catch (error) {
        logger.error(`Error creating/updating group subscription for ${groupId}:`, error);
        throw error;
    }
}

async function getGroupSubscription(groupId) {
    const database = await getDatabase();
    const collection = database.collection("group_subscriptions");
    
    try {
        const subscription = await collection.findOne({ groupId });
        if (!subscription) return null;

        subscription.active = subscription.expiresAt > new Date();
        return subscription;
    } catch (error) {
        logger.error(`Error getting group subscription for ${groupId}:`, error);
        return null;
    }
}

async function updateGroupSubscriptionPayment(groupId, paymentId, status, transactionHashes = {}) {
    const database = await getDatabase();
    const collection = database.collection("group_subscriptions");
    
    try {
        const result = await collection.updateOne(
            { 
                groupId,
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

        logger.info(`Updated group payment status for ${groupId}, payment ${paymentId} to ${status}`);
        return result.modifiedCount > 0;
    } catch (error) {
        logger.error(`Error updating group payment for ${groupId}:`, error);
        return false;
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
    createOrUpdateSubscription,
    checkSubscription,
    getSubscription,
    completeSubscriptionPayment,
    addAdmin,
    savePaymentAddress,
    getPaymentAddress,
    updatePaymentAddressStatus,
    cleanupExpiredPaymentAddresses,
    createOrUpdateGroupSubscription,
    getGroupSubscription,
    updateGroupSubscriptionPayment
};
