const { getDatabase } = require('./database');
const fs = require('fs').promises;

async function getWalletsByWinrate(minWinrate) {
    const db = await getDatabase();
    const collection = db.collection('wallets');
    
    return await collection.find({ 'data.winrate': { $gte: minWinrate } }).toArray();
}

async function getWalletsByCriteria(criteria) {
    const db = await getDatabase();
    const collection = db.collection('wallets');
    
    return await collection.find(criteria).toArray();
}

async function exportWalletsToJson(wallets, filename) {
    const jsonData = JSON.stringify(wallets, null, 2);
    await fs.writeFile(filename, jsonData);
    return `Exported ${wallets.length} wallets to ${filename}`;
}

async function getAllWallets() {
    const db = await getDatabase();
    const collection = db.collection('wallets');
    
    return await collection.find({}).toArray();
}

module.exports = {
    getWalletsByWinrate,
    getWalletsByCriteria,
    exportWalletsToJson,
    getAllWallets
};