/**
 * Wallet Update Manager
 * 
 * This manager automatically updates wallet data that is older than a specified threshold
 * with a rate limit to avoid overloading the API. It runs as part of the bot process.
 */

const { getDatabase } = require('../database/config/connection');
const gmgnApi = require('../integrations/gmgnApi');
const WalletService = require('../database/services/walletService');
const logger = require('../utils/logger');

class WalletUpdateManager {
    constructor(options = {}) {
        // Configuration with defaults
        this.ageDays = options.ageDays || 7; // Wallets older than 7 days will be updated
        this.walletsPerMinute = options.walletsPerMinute || 10; // Rate limit
        this.updateInterval = Math.floor(60000 / this.walletsPerMinute); // Interval in ms between wallet updates
        this.logInterval = options.logInterval || 60 * 60 * 1000; // Log stats every hour
        
        this.running = false;
        this.updateTimeout = null;
        this.logTimeout = null;
        this.lastLogTime = Date.now();
        
        // Stats tracking
        this.stats = {
            totalProcessed: 0,
            successfulUpdates: 0,
            failedUpdates: 0,
            apiErrors: 0,
            dbErrors: 0,
            lastUpdatedWallet: null,
            startTime: null
        };
    }

    /**
     * Calculate the cutoff date for wallet updates
     * @returns {Date} Cutoff date
     */
    getCutoffDate() {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - this.ageDays);
        return cutoffDate;
    }

    /**
     * Get a wallet that needs updating
     * @returns {Object|null} Wallet document or null if none found
     */
    async getWalletForUpdate() {
        try {
            const database = await getDatabase();
            const cutoffDate = this.getCutoffDate();
            
            return await database.collection('wallets')
                .findOne({ lastUpdated: { $lt: cutoffDate } }, { sort: { lastUpdated: 1 } });
        } catch (error) {
            logger.error('Error fetching wallet for update:', error);
            this.stats.dbErrors++;
            return null;
        }
    }

    /**
     * Update a single wallet using the gmgn API
     * @param {String} address - Wallet address
     * @returns {Boolean} Success status
     */
    async updateWallet(address) {
        try {
            logger.debug(`Updating wallet: ${address}`);
            
            // Fetch updated data from API
            const response = await gmgnApi.getWalletData(
                address, 
                'walletUpdateManager', 
                'autoUpdate'
            );
            
            if (!response || response.code !== 0) {
                logger.warn(`API returned error for wallet ${address}:`, 
                    response ? `Code: ${response.code}, Msg: ${response.msg}` : 'No response');
                this.stats.apiErrors++;
                return false;
            }
            
            // Save updated data to database
            const result = await WalletService.saveInterestingWallet(address, response.data);
            
            if (result) {
                logger.debug(`Successfully updated wallet ${address}`);
                this.stats.lastUpdatedWallet = address;
                this.stats.successfulUpdates++;
                return true;
            } else {
                logger.warn(`No update performed for wallet ${address}`);
                this.stats.failedUpdates++;
                return false;
            }
        } catch (error) {
            logger.error(`Error updating wallet ${address}:`, error);
            this.stats.failedUpdates++;
            this.stats.apiErrors++;
            return false;
        }
    }

    /**
     * Log statistics about the update manager's performance
     */
    logStats() {
        if (!this.running) return;
        
        const now = Date.now();
        const runningTime = Math.floor((now - this.stats.startTime) / 1000 / 60); // minutes
        
        logger.info('Wallet Update Manager Statistics', {
            runningTime: `${runningTime} minutes`,
            totalProcessed: this.stats.totalProcessed,
            successRate: `${this.stats.totalProcessed > 0 ? 
                Math.round((this.stats.successfulUpdates / this.stats.totalProcessed) * 100) : 0}%`,
            successful: this.stats.successfulUpdates,
            failed: this.stats.failedUpdates,
            apiErrors: this.stats.apiErrors,
            dbErrors: this.stats.dbErrors,
            lastUpdated: this.stats.lastUpdatedWallet,
            walletAgeThreshold: `${this.ageDays} days`,
            updateRate: `${this.walletsPerMinute} per minute`
        });
        
        this.lastLogTime = now;
        
        // Schedule next log
        this.logTimeout = setTimeout(() => this.logStats(), this.logInterval);
    }

    /**
     * Process the next wallet that needs updating
     */
    async processNextWallet() {
        if (!this.running) return;
        
        try {
            // Get a wallet to update
            const wallet = await this.getWalletForUpdate();
            
            if (wallet) {
                this.stats.totalProcessed++;
                await this.updateWallet(wallet.address);
                
                // Check if it's time to log stats
                if (Date.now() - this.lastLogTime >= this.logInterval) {
                    this.logStats();
                }
            }
            
            // Schedule the next update
            this.updateTimeout = setTimeout(() => this.processNextWallet(), this.updateInterval);
        } catch (error) {
            logger.error('Error in wallet update process:', error);
            // Schedule retry
            this.updateTimeout = setTimeout(() => this.processNextWallet(), this.updateInterval);
        }
    }

    /**
     * Start the wallet update manager
     */
    start() {
        if (this.running) {
            logger.warn('Wallet Update Manager is already running');
            return;
        }
        
        this.running = true;
        this.stats.startTime = Date.now();
        logger.info(`Starting Wallet Update Manager - updating wallets older than ${this.ageDays} days`);
        logger.info(`Rate limit: ${this.walletsPerMinute} wallets per minute (one every ${this.updateInterval}ms)`);
        
        // Start processing wallets
        this.processNextWallet();
        
        // Setup logging
        this.logStats();
    }

    /**
     * Stop the wallet update manager
     */
    stop() {
        if (!this.running) {
            logger.warn('Wallet Update Manager is not running');
            return;
        }
        
        logger.info('Stopping Wallet Update Manager');
        this.running = false;
        
        // Clear timeouts
        if (this.updateTimeout) {
            clearTimeout(this.updateTimeout);
            this.updateTimeout = null;
        }
        
        if (this.logTimeout) {
            clearTimeout(this.logTimeout);
            this.logTimeout = null;
        }
        
        // Log final stats
        this.logStats();
    }
}

module.exports = WalletUpdateManager;