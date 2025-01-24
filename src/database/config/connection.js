const { MongoClient } = require('mongodb');
const config = require('../../utils/config');
const logger = require('../../utils/logger');
const { updateIndexes } = require('../utils/indexesConfig');

let mongoClient = null;
let db = null;

const uri = config.MONGODB_URI?.trim() || process.env.MONGODB_URI?.trim();
if (!uri) throw new Error('MONGODB_URI is not defined');
if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
    throw new Error(`Invalid MongoDB URI: ${uri}`);
}

function initializeClient() {
    if (!mongoClient) {
        mongoClient = new MongoClient(uri, {
            connectTimeoutMS: 5000,
            socketTimeoutMS: 30000,
        });
        mongoClient.setMaxListeners(20);
        
        mongoClient.on('close', async () => {
            logger.warn("Connection lost. Attempting to reconnect...");
            db = null;
            try {
                await connectToDatabase();
            } catch (error) {
                logger.error("Reconnection failed:", error);
            }
        });
    }
    return mongoClient;
}

async function connectToDatabase() {
    if (!db) {
        const client = initializeClient();
        await client.connect();
        db = client.db("telegram_bot");
        await updateIndexes(db);
    }
    return db;
}

async function getDatabase() {
    return db || await connectToDatabase();
}

process.on('SIGINT', async () => {
    if (mongoClient) await mongoClient.close();
    process.exit(0);
});

module.exports = {
    connectToDatabase,
    getDatabase
};