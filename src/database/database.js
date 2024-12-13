const { MongoClient } = require('mongodb');
const config = require('../utils/config');
const logger = require('../utils/logger'); 
const { validateWallet } = require('./models/wallet');

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
            db = client.db("interesting_wallets");
            logger.info("Connected to the database");
            client.on('close', async () => {
                logger.warn("Connection to database lost. Attempting to reconnect...");
                db = null;
                await connectToDatabase();
            });
            await db.collection("wallets").createIndex({ address: 1 }, { unique: true });
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
    
    // Vérifier si le wallet existe déjà et si sa refresh_date est plus récente que 7 jours
    const existingWallet = await collection.findOne({ address });
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000); // 15 minutes en millisecondes
    
    if (existingWallet && existingWallet.refresh_date > fifteenMinutesAgo) {
        logger.debug(`Wallet ${address} was refreshed recently. Skipping update.`);
        return null;
    }

    // Gérer twitter_bind de manière plus robuste
    let twitterBind = null;
    if (walletData.twitter_bind) {
        try {
            // Si c'est déjà une string, on la garde, sinon on la convertit
            twitterBind = typeof walletData.twitter_bind === 'string' 
                ? walletData.twitter_bind 
                : JSON.stringify(walletData.twitter_bind);
        } catch (error) {
            logger.warn(`Could not process twitter_bind for wallet ${address}, setting to null`);
            twitterBind = null;
        }
    }

    // Fonction helper pour convertir null/undefined en 0
    const normalizeValue = (value) => {
        if (value === null || value === undefined || isNaN(value)) {
            return 0;
        }
        // Si c'est une chaîne numérique, la convertir en nombre
        if (typeof value === 'string' && !isNaN(value)) {
            return parseFloat(value);
        }
        return value;
    };

    // Créer un objet avec les valeurs normalisées
    const walletToSave = {
        address,
        balance: normalizeValue(walletData.balance),
        total_value: normalizeValue(walletData.total_value),
        realized_profit_30d: normalizeValue(walletData.realized_profit_30d),
        winrate: normalizeValue(walletData.winrate),
        buy_30d: normalizeValue(walletData.buy_30d),
        token_avg_cost: normalizeValue(walletData.token_avg_cost),
        token_sold_avg_profit: normalizeValue(walletData.token_sold_avg_profit),
        pnl_2x_5x_num: normalizeValue(walletData.pnl_2x_5x_num),
        pnl_gt_5x_num: normalizeValue(walletData.pnl_gt_5x_num),
        twitter_bind: twitterBind,
        refresh_date: new Date(),
        lastUpdated: new Date()
    };

    const { error } = validateWallet(walletToSave);
    if (error) {
        logger.warn(`Validation warning for wallet ${address}: ${error.details[0].message}`);
        // Supprimer twitter_bind si c'est la source de l'erreur
        if (error.details[0].path.includes('twitter_bind')) {
            delete walletToSave.twitter_bind;
            const secondValidation = validateWallet(walletToSave);
            if (secondValidation.error) {
                logger.error(`Still invalid wallet data after removing twitter_bind:`, secondValidation.error.details[0].message);
                throw new Error(`Invalid wallet data: ${secondValidation.error.details[0].message}`);
            }
        } else {
            throw new Error(`Invalid wallet data: ${error.details[0].message}`);
        }
    }

    try {
        const result = await collection.updateOne(
            { address: address },
            { $set: walletToSave },
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
        logger.error("Error saving wallet to database:", error);
        throw error;
    }
}

module.exports = { connectToDatabase, getDatabase, saveInterestingWallet };