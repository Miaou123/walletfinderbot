const { getDatabase } = require('../config/connection');
const { validateWallet } = require('../models/wallet');
const logger = require('../../utils/logger');
const fs = require('fs').promises;

class WalletService {
    static async saveInterestingWallet(address, walletData) {
        if (!walletData) {
            logger.error(`No wallet data provided for address ${address}`);
            return null;
        }

        const database = await getDatabase();
        const collection = database.collection("wallets");
        
        const existingWallet = await collection.findOne({ address });
        const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
        
        if (existingWallet?.refresh_date > fifteenMinutesAgo) {
            return null;
        }
    
        try {
            // On garde toutes les données de l'API telles quelles
            const walletToSave = {
                address,
                // On étale toutes les données de l'API
                ...walletData,
                // On ajoute nos champs de métadonnées
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
                { 
                    $set: validatedWallet || walletToSave,
                    // On conserve certains champs historiques si ils existent
                    $setOnInsert: {
                        created_at: new Date()
                    }
                },
                { upsert: true }
            );
        } catch (error) {
            logger.error(`Error saving wallet ${address}:`, error);
            return null;
        }
    }

    /**
     * Get wallets with winrate greater than or equal to specified value
     * @param {number} minWinrate - Minimum winrate as a decimal (0-1)
     * @param {number} limit - Maximum number of results to return
     * @returns {Promise<Array>} Array of wallet documents
     */
    static async getWalletsByWinrate(minWinrate, limit = 500) {
        try {
            const database = await getDatabase();
            return await database.collection('wallets')
                .find({ 'winrate': { $gte: minWinrate } })
                .limit(limit)
                .toArray();
        } catch (error) {
            logger.error('Error in getWalletsByWinrate:', error);
            throw error;
        }
    }

    /**
     * Get wallets matching specified criteria with pagination
     * @param {Object} criteria - MongoDB query criteria
     * @param {Object} options - Query options (limit, skip, sort)
     * @returns {Promise<Array>} Array of wallet documents matching criteria
     */
    static async getWalletsByCriteria(criteria, options = {}) {
        try {
            const database = await getDatabase();
            const { limit = 500, skip = 0, sort = { total_value: -1 } } = options;
            
            logger.info(`Searching wallets with criteria: ${JSON.stringify(criteria)}`);
            
            // Handle special criteria that may need pre-processing
            const processedCriteria = { ...criteria };
            
            // Process sol_balance comparison for both string and number types
            if (processedCriteria.sol_balance && 
                typeof processedCriteria.sol_balance === 'object' && 
                processedCriteria.sol_balance.$gte) {
                
                const minSolBalance = processedCriteria.sol_balance.$gte;
                
                // Create a query that handles both string and number types
                processedCriteria.$or = [
                    // For numeric fields
                    { sol_balance: { $gte: parseFloat(minSolBalance) } },
                    // For string fields that can be parsed as numbers
                    { 
                        sol_balance: { 
                            $exists: true,
                            $ne: null,
                            $type: 'string',
                            $regex: /^[0-9]*\.?[0-9]+$/ 
                        } 
                    }
                ];
                
                // Remove the original sol_balance criteria
                delete processedCriteria.sol_balance;
            }
            
            // Execute query
            const wallets = await database.collection('wallets')
                .find(processedCriteria)
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .toArray();
            
            // Post-process results for sol_balance string comparison if needed
            if (criteria.sol_balance && typeof criteria.sol_balance === 'object' && criteria.sol_balance.$gte) {
                const minSolBalance = parseFloat(criteria.sol_balance.$gte);
                
                if (!isNaN(minSolBalance)) {
                    return wallets.filter(wallet => {
                        // For string values, parse to float before comparing
                        if (typeof wallet.sol_balance === 'string') {
                            const solBalance = parseFloat(wallet.sol_balance);
                            return !isNaN(solBalance) && solBalance >= minSolBalance;
                        }
                        // For numeric values, compare directly
                        else if (typeof wallet.sol_balance === 'number') {
                            return wallet.sol_balance >= minSolBalance;
                        }
                        // Skip invalid values
                        return false;
                    });
                }
            }
            
            logger.info(`Found ${wallets.length} wallets matching criteria`);
            return wallets;
        } catch (error) {
            logger.error('Error in getWalletsByCriteria:', error);
            throw error;
        }
    }

    /**
     * Get all wallets with optional limit
     * @param {number} limit - Maximum number of results to return
     * @returns {Promise<Array>} Array of wallet documents
     */
    static async getAllWallets(limit = 1000) {
        try {
            const database = await getDatabase();
            return await database.collection('wallets')
                .find({})
                .limit(limit)
                .toArray();
        } catch (error) {
            logger.error('Error in getAllWallets:', error);
            throw error;
        }
    }

    /**
     * Get recent wallet data if available in cache
     * @param {string} address - Wallet address
     * @param {number} cacheMinutes - Cache time in minutes
     * @returns {Promise<Object|null>} Wallet document or null if not found or expired
     */
    static async getRecentWallet(address, cacheMinutes = 15) {
        try {
            const database = await getDatabase();
            const cacheTime = new Date(Date.now() - cacheMinutes * 60 * 1000);

            return await database.collection('wallets').findOne({
                address,
                refresh_date: { $gt: cacheTime }
            });
        } catch (error) {
            logger.error('Error in getRecentWallet:', error);
            return null;
        }
    }

    /**
     * Export wallets to JSON file
     * @param {Array} wallets - Array of wallet objects
     * @param {string} filename - Output filename
     * @returns {Promise<string>} Success message
     */
    static async exportWalletsToJson(wallets, filename) {
        try {
            const jsonData = JSON.stringify(wallets, null, 2);
            await fs.writeFile(filename, jsonData);
            return `Exported ${wallets.length} wallets to ${filename}`;
        } catch (error) {
            logger.error('Error exporting wallets to JSON:', error);
            throw error;
        }
    }

    /**
     * Create the necessary indexes for wallet collection
     * @returns {Promise<void>}
     */
    static async ensureIndexes() {
        try {
            const database = await getDatabase();
            const collection = database.collection('wallets');
            
            // Create indexes for commonly queried fields
            await collection.createIndex({ address: 1 }, { unique: true });
            await collection.createIndex({ winrate: 1 });
            await collection.createIndex({ total_value: 1 });
            await collection.createIndex({ realized_profit_30d: 1 });
            await collection.createIndex({ sol_balance: 1 });
            await collection.createIndex({ refresh_date: 1 });
            
            logger.info('Wallet collection indexes created');
        } catch (error) {
            logger.error('Error ensuring wallet indexes:', error);
            // Don't throw, just log the error
        }
    }

    /**
     * Delete wallets with lastUpdated date older than a specified time period
     * @param {number} months - Number of months to consider for deletion (default: 3)
     * @returns {Promise<Object>} Result containing deleted count
     */
    static async cleanOldWallets(months = 3) {
        try {
            const database = await getDatabase();
            const collection = database.collection('wallets');
            
            // Calculate cutoff date (3 months ago by default)
            const cutoffDate = new Date();
            cutoffDate.setMonth(cutoffDate.getMonth() - months);
            
            logger.info(`Cleaning wallets last updated before: ${cutoffDate.toISOString()}`);
            
            // Delete wallets with lastUpdated older than the cutoff date
            const result = await collection.deleteMany({
                lastUpdated: { $lt: cutoffDate }
            });
            
            logger.info(`Cleaned up ${result.deletedCount} old wallet records`);
            return {
                success: true,
                deletedCount: result.deletedCount,
                cutoffDate: cutoffDate
            };
        } catch (error) {
            logger.error('Error cleaning old wallets:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = WalletService;