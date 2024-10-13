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
    const existingWallet = await collection.findOne({ address });
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    if (existingWallet && existingWallet.refresh_date > sevenDaysAgo) {
        logger.debug(`Wallet ${address} was refreshed recently. Skipping update.`);
        return null;
    }

    const walletToSave = {
        address,
        ...walletData,
        twitter_bind: walletData.twitter_bind || null,
        refresh_date: new Date(),
        lastUpdated: new Date()
    };

    const { error } = validateWallet(walletToSave);
    if (error) {
        logger.error(`Invalid wallet data for address ${address}:`, error.details[0].message);
        throw new Error(`Invalid wallet data: ${error.details[0].message}`);
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