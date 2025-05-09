/**
 * Wallet Update Daemon
 * 
 * This daemon continuously updates wallet data that is older than 1 week
 * with a rate limit of 10 wallets per minute to avoid overloading the API.
 * 
 * Usage: node src/tools/walletUpdateDaemon.js [days]
 * 
 * The optional 'days' parameter specifies how old a wallet record should be
 * before it's considered for updating (default: 7 days)
 */

const { getDatabase } = require('../database/config/connection');
const gmgnApi = require('../integrations/gmgnApi');
const WalletService = require('../database/services/walletService');
const logger = require('../utils/logger');

// Configuration
const DEFAULT_AGE_DAYS = 7;
const WALLETS_PER_MINUTE = 10;
const UPDATE_INTERVAL = Math.floor(60000 / WALLETS_PER_MINUTE); // Interval in ms between wallet updates
const LOG_INTERVAL = 60 * 60 * 1000; // Log stats every hour

class WalletUpdateDaemon {
    constructor(ageDays = DEFAULT_AGE_DAYS) {
        this.ageDays = ageDays;
        this.running = false;
        this.lastLogTime = Date.now();
        
        // Stats tracking
        this.stats = {
            totalProcessed: 0,
            successfulUpdates: 0,
            failedUpdates: 0,
            apiErrors: 0,
            dbErrors: 0,
            lastUpdatedWallet: null,
            startTime: new Date()
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
     * Get a batch of wallets that need updating
     * @param {Object} database - MongoDB database connection
     * @param {Number} batchSize - Number of wallets to fetch
     * @returns {Array} Array of wallet documents
     */
    async getWalletsForUpdate(database, batchSize) {
        try {
            const cutoffDate = this.getCutoffDate();
            logger.debug(`Fetching wallets last updated before: ${cutoffDate.toISOString()}`);
            
            return await database.collection('wallets')
                .find({ lastUpdated: { $lt: cutoffDate } })
                .sort({ lastUpdated: 1 }) // Update oldest first
                .limit(batchSize)
                .toArray();
        } catch (error) {
            logger.error('Error fetching wallets for update:', error);
            this.stats.dbErrors++;
            return [];
        }
    }

    /**
     * Update a single wallet using the gmgn API
     * @param {String} address - Wallet address
     * @returns {Boolean} Success status
     */
    async updateWallet(address) {
        try {
            logger.info(`Updating wallet: ${address}`);
            
            // Fetch updated data from API
            const response = await gmgnApi.getWalletData(
                address, 
                'walletUpdateDaemon', 
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
                logger.info(`Successfully updated wallet ${address}`);
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
     * Log statistics about the daemon's performance
     */
    logStats() {
        const now = Date.now();
        const runningTime = Math.floor((now - this.stats.startTime) / 1000 / 60); // minutes
        
        logger.info('Wallet Update Daemon Statistics', {
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
            updateRate: `${WALLETS_PER_MINUTE} per minute`
        });
        
        this.lastLogTime = now;
    }

    /**
     * Start the wallet update daemon
     */
    async start() {
        if (this.running) {
            logger.warn('Wallet Update Daemon is already running');
            return;
        }
        
        this.running = true;
        this.stats.startTime = new Date();
        logger.info(`Starting Wallet Update Daemon - updating wallets older than ${this.ageDays} days`);
        logger.info(`Rate limit: ${WALLETS_PER_MINUTE} wallets per minute (one every ${UPDATE_INTERVAL}ms)`);
        
        const database = await getDatabase();
        
        // Initialize the browser
        await gmgnApi.initializeBrowser().catch(error => {
            logger.error('Failed to initialize browser:', error);
        });
        
        // Main update loop
        while (this.running) {
            try {
                // Get a batch of wallets to update
                const walletsToUpdate = await this.getWalletsForUpdate(database, 1);
                
                if (walletsToUpdate.length === 0) {
                    logger.info('No wallets need updating at this time');
                    // Sleep for a while before checking again
                    await new Promise(resolve => setTimeout(resolve, 60000));
                    continue;
                }
                
                // Update each wallet with rate limiting
                for (const wallet of walletsToUpdate) {
                    if (!this.running) break;
                    
                    this.stats.totalProcessed++;
                    await this.updateWallet(wallet.address);
                    
                    // Check if it's time to log stats
                    if (Date.now() - this.lastLogTime >= LOG_INTERVAL) {
                        this.logStats();
                    }
                    
                    // Rate limit - wait before processing the next wallet
                    await new Promise(resolve => setTimeout(resolve, UPDATE_INTERVAL));
                }
            } catch (error) {
                logger.error('Error in wallet update cycle:', error);
                this.stats.dbErrors++;
                
                // Sleep for a bit before retrying
                await new Promise(resolve => setTimeout(resolve, 30000));
            }
        }
    }

    /**
     * Stop the wallet update daemon
     */
    stop() {
        if (!this.running) {
            logger.warn('Wallet Update Daemon is not running');
            return;
        }
        
        logger.info('Stopping Wallet Update Daemon');
        this.running = false;
        this.logStats();
        
        // Close the browser
        gmgnApi.closeBrowser().catch(error => {
            logger.error('Error closing browser:', error);
        });
    }
}

// Handle process termination
process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT signal');
    if (daemon) {
        daemon.stop();
    }
    setTimeout(() => process.exit(0), 1000);
});

process.on('SIGTERM', async () => {
    console.log('\nReceived SIGTERM signal');
    if (daemon) {
        daemon.stop();
    }
    setTimeout(() => process.exit(0), 1000);
});

// Get age threshold from command line argument
const ageDays = parseInt(process.argv[2]) || DEFAULT_AGE_DAYS;

// Create and start the daemon
const daemon = new WalletUpdateDaemon(ageDays);
daemon.start().catch(error => {
    logger.error('Failed to start Wallet Update Daemon:', error);
    process.exit(1);
});