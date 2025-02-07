const { getDatabase } = require('../config/connection');
const { validateWallet } = require('../models/wallet');
const logger = require('../../utils/logger');
const fs = require('fs').promises;

class WalletService {
    static async saveInterestingWallet(address, walletData) {
        const database = await getDatabase();
        const collection = database.collection("wallets");
        
        const existingWallet = await collection.findOne({ address });
        const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
        
        if (existingWallet?.refresh_date > fifteenMinutesAgo) {
            return null;
        }

        try {
            const walletToSave = {
                address,
                ...walletData,
                refresh_date: new Date(),
                lastUpdated: new Date()
            };

            const { error, value: validatedWallet } = validateWallet(walletToSave);
            if (error) {
                logger.warn(`Validation warning: ${error.details[0].message}`, {
                    wallet: address,
                    error: error.details
                });
            }

            return await collection.updateOne(
                { address },
                { $set: validatedWallet || walletToSave },
                { upsert: true }
            );
        } catch (error) {
            logger.error(`Error saving wallet ${address}:`, error);
            return null;
        }
    }

    static async getWalletsByWinrate(minWinrate) {
        const database = await getDatabase();
        return await database.collection('wallets')
            .find({ 'data.winrate': { $gte: minWinrate } })
            .toArray();
    }

    static async getWalletsByCriteria(criteria) {
        const database = await getDatabase();
        return await database.collection('wallets')
            .find(criteria)
            .toArray();
    }

    static async getAllWallets() {
        const database = await getDatabase();
        return await database.collection('wallets')
            .find({})
            .toArray();
    }

    static async getRecentWallet(address) {
        const database = await getDatabase();
        const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

        return await database.collection('wallets').findOne({
            address,
            refresh_date: { $gt: fifteenMinutesAgo }
        });
    }

    static async exportWalletsToJson(wallets, filename) {
        const jsonData = JSON.stringify(wallets, null, 2);
        await fs.writeFile(filename, jsonData);
        return `Exported ${wallets.length} wallets to ${filename}`;
    }
}

module.exports = WalletService;