const { MongoClient } = require('mongodb');
const config = require('../utils/config');
const logger = require('../utils/logger'); 
const { validateWallet } = require('./models/wallet');

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
   
   mongoClient.on('close', () => {
       logger.warn("Connection lost, will reconnect on next request");
       db = null;
   });
}

async function getDatabase() {
   if (!db) {
       try {
           await mongoClient.connect();
           db = mongoClient.db("interesting_wallets");
           await db.collection("wallets").createIndex({ address: 1 }, { unique: true });
           logger.info("Connected to the database");
       } catch (error) {
           logger.error("Database connection error:", error);
           throw error;
       }
   }
   return db;
}

async function saveInterestingWallet(address, walletData) {
   const database = await getDatabase();
   const collection = database.collection("wallets");
   
   const existingWallet = await collection.findOne({ address });
   const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
   
   if (existingWallet?.refresh_date > fifteenMinutesAgo) {
       logger.debug(`Wallet ${address} was refreshed recently. Skipping update.`);
       return null;
   }

   const twitterBind = walletData.twitter_bind ? 
       (typeof walletData.twitter_bind === 'string' ? 
           walletData.twitter_bind : 
           JSON.stringify(walletData.twitter_bind)) : 
       null;

   const normalizeValue = (value) => {
       if (value === null || value === undefined || isNaN(value)) return 0;
       return typeof value === 'string' ? parseFloat(value) : value;
   };

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
       if (error.details[0].path.includes('twitter_bind')) {
           delete walletToSave.twitter_bind;
           const secondValidation = validateWallet(walletToSave);
           if (secondValidation.error) {
               throw new Error(`Invalid wallet data: ${secondValidation.error.details[0].message}`);
           }
       } else {
           throw new Error(`Invalid wallet data: ${error.details[0].message}`);
       }
   }

   try {
       const result = await collection.updateOne(
           { address },
           { $set: walletToSave },
           { upsert: true }
       );
       
       if (result.upsertedCount > 0) {
           logger.info(`Successfully saved wallet ${address} to database`);
       } else if (result.modifiedCount > 0) {
           logger.info(`Existing wallet ${address} updated in database`);
       }
       
       return result;
   } catch (error) {
       logger.error("Database save error:", error);
       throw error;
   }
}

process.on('SIGINT', async () => {
   if (mongoClient) {
       await mongoClient.close();
   }
   process.exit(0);
});

module.exports = { getDatabase, saveInterestingWallet };