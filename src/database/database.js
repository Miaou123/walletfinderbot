const { MongoClient } = require('mongodb');
const config = require('../config/config');

// Ajout de logs pour déboguer
console.log('MONGODB_URI from config:', config.MONGODB_URI);
console.log('MONGODB_URI from process.env:', process.env.MONGODB_URI);

let uri = config.MONGODB_URI || process.env.MONGODB_URI;

if (!uri) {
    throw new Error('MONGODB_URI is not defined in environment variables or config file');
}

uri = uri.trim();

if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
    throw new Error(`Invalid MongoDB URI: ${uri}. URI must start with mongodb:// or mongodb+srv://`);
}

console.log('Cleaned MONGODB_URI:', uri);

const client = new MongoClient(uri);

let db;

async function connectToDatabase() {
    if (!db) {
        try {
            await client.connect();
            db = client.db("interesting_wallets");
            console.log("Connected to the database");
            await db.collection("wallets").createIndex({ address: 1 }, { unique: true });
        } catch (error) {
            console.error("Error connecting to the database:", error);
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
    
    const {
        balance,
        total_value,
        realized_profit_30d,
        winrate,
        buy_30d,
        token_avg_cost,
        token_sold_avg_profit,
        pnl_2x_5x_num,
        pnl_gt_5x_num
    } = walletData;

    const walletToSave = {
        address,
        balance,
        total_value,
        realized_profit_30d,
        winrate,
        buy_30d,
        token_avg_cost,
        token_sold_avg_profit,
        pnl_2x_5x_num,
        pnl_gt_5x_num,
        lastUpdated: new Date()
    };

    try {
        const result = await collection.updateOne(
            { address: address },
            { $set: walletToSave },
            { upsert: true }
        );
        
        if (result.upsertedCount > 0) {
            console.log(`New wallet ${address} saved to database`);
        } else if (result.modifiedCount > 0) {
            console.log(`Existing wallet ${address} updated in database`);
        } else {
            console.log(`Wallet ${address} already up to date in database`);
        }
        
        return result;
    } catch (error) {
        console.error("Error saving wallet to database:", error);
        throw error;
    }
}

module.exports = { connectToDatabase, getDatabase, saveInterestingWallet };