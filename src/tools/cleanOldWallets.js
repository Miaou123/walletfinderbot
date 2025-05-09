/**
 * Script to clean up old wallet records from the database
 * Usage: node src/tools/cleanOldWallets.js [months]
 * 
 * Example: node src/tools/cleanOldWallets.js 3
 * This will clean up wallet records not updated in the last 3 months
 */

const WalletService = require('../database/services/walletService');
const logger = require('../utils/logger');
const { getDatabase } = require('../database/config/connection');

async function runCleanup() {
    try {
        // Get the number of months from command line argument, default to 3
        const months = process.argv[2] ? parseInt(process.argv[2]) : 3;
        
        if (isNaN(months) || months <= 0) {
            logger.error('Invalid months parameter. Please provide a positive number.');
            process.exit(1);
        }

        logger.info(`Starting cleanup of wallets not updated in the last ${months} months`);
        
        // Ensure database connection
        await getDatabase();
        
        // Run the cleanup operation
        const result = await WalletService.cleanOldWallets(months);
        
        if (result.success) {
            logger.info(`Cleanup completed successfully. Deleted ${result.deletedCount} wallet records older than ${result.cutoffDate.toISOString()}`);
        } else {
            logger.error(`Cleanup failed: ${result.error}`);
        }
        
        // Close database connection
        process.exit(0);
    } catch (error) {
        logger.error('Error running wallet cleanup:', error);
        process.exit(1);
    }
}

// Run the cleanup
runCleanup();