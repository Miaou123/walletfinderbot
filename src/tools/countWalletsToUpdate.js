/**
 * Count Wallets To Update
 * 
 * This script counts the number of wallets in the database
 * that need updating based on the specified age threshold.
 * 
 * Usage: node src/tools/countWalletsToUpdate.js [days]
 * 
 * The optional 'days' parameter specifies how old a wallet record should be
 * before it's considered for updating (default: 7 days)
 */

const { getDatabase } = require('../database/config/connection');
const logger = require('../utils/logger');

// Configuration
const DEFAULT_AGE_DAYS = 7;

async function countWalletsToUpdate(ageDays = DEFAULT_AGE_DAYS) {
    try {
        // Connect to database
        const database = await getDatabase();
        
        // Calculate cutoff date
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - ageDays);
        
        console.log(`Counting wallets last updated before: ${cutoffDate.toISOString()}`);
        
        // Count wallets needing update
        const count = await database.collection('wallets')
            .countDocuments({ lastUpdated: { $lt: cutoffDate } });
        
        // Count total wallets
        const totalCount = await database.collection('wallets')
            .countDocuments({});
        
        console.log(`\nWallet Update Statistics:`);
        console.log(`Total wallets in database: ${totalCount}`);
        console.log(`Wallets older than ${ageDays} days: ${count} (${((count/totalCount)*100).toFixed(2)}%)`);
        console.log(`Wallets up to date: ${totalCount - count} (${(((totalCount-count)/totalCount)*100).toFixed(2)}%)`);
        
        return {
            total: totalCount,
            needsUpdate: count,
            upToDate: totalCount - count,
            percentageNeedsUpdate: (count/totalCount)*100,
            ageThreshold: ageDays
        };
    } catch (error) {
        console.error('Error counting wallets:', error);
        return null;
    } finally {
        // Make sure the process exits
        process.exit(0);
    }
}

// Get age threshold from command line argument
const ageDays = parseInt(process.argv[2]) || DEFAULT_AGE_DAYS;

// Execute the count
countWalletsToUpdate(ageDays).catch(error => {
    console.error('Error:', error);
    process.exit(1);
});