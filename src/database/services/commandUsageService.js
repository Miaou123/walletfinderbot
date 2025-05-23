const { getDatabase } = require('../config/connection');
const { validateCommandUsage } = require('../models/commandUsage');
const logger = require('../../utils/logger');

const COLLECTION_NAME = 'commandUsage';

class CommandUsageService {
    static async getCollection() {
        const db = await getDatabase();
        return db.collection(COLLECTION_NAME);
    }

/**
 * Track a command usage
 * @param {string} command - Command name
 * @param {string} userId - User ID
 * @param {string} username - Username (optional)
 * @param {boolean} isAdmin - Whether this is an admin command
 */
static async trackCommandUsage(command, userId, username = null, isAdmin = false) {
    try {
        const collection = await this.getCollection();
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const now = new Date();

        // Normalize username - can be null
        const normalizedUsername = username ? username.toLowerCase() : null;

        // First, ensure the document exists with basic structure
        await collection.updateOne(
            { command },
            {
                $setOnInsert: {
                    command,
                    totalUsage: 0,
                    createdAt: now,
                    dailyStats: [], // Initialize empty array
                    userUsage: {}
                }
            },
            { upsert: true }
        );

        // Now update the usage counts
        const updateOps = {
            $inc: { 
                totalUsage: 1,
                [`userUsage.${userId}.count`]: 1
            },
            $set: { 
                lastUsed: now,
                lastUpdated: now,
                [`userUsage.${userId}.lastUsed`]: now,
                [`userUsage.${userId}.username`]: normalizedUsername
            }
        };

        await collection.updateOne(
            { command },
            updateOps
        );

        // Handle daily stats separately
        const existingDoc = await collection.findOne({ command });
        const todayEntry = existingDoc.dailyStats.find(stat => stat.date === today);

        if (todayEntry) {
            // Update existing daily stat
            await collection.updateOne(
                { command, 'dailyStats.date': today },
                { 
                    $inc: { 'dailyStats.$.count': 1 }
                }
            );
        } else {
            // Add new daily stat entry
            await collection.updateOne(
                { command },
                {
                    $push: {
                        dailyStats: {
                            date: today,
                            count: 1,
                            uniqueUsers: 1
                        }
                    }
                }
            );
        }

        // Update unique users count for today
        await this.updateDailyUniqueUsers(command, today);

        logger.debug(`Tracked usage for command ${command} by user ${userId}`);
        return true;
    } catch (error) {
        logger.error(`Error tracking command usage for ${command}:`, error);
        return false;
    }
}

    /**
     * Update unique users count for a specific date
     * @param {string} command - Command name
     * @param {string} date - Date in YYYY-MM-DD format
     */
    static async updateDailyUniqueUsers(command, date) {
        try {
            const collection = await this.getCollection();
            
            // Get the command document
            const commandDoc = await collection.findOne({ command });
            if (!commandDoc) return;

            // Count unique users who used the command today
            const uniqueUsersToday = new Set();
            
            Object.entries(commandDoc.userUsage || {}).forEach(([userId, userData]) => {
                const lastUsed = new Date(userData.lastUsed);
                const usedToday = lastUsed.toISOString().split('T')[0] === date;
                if (usedToday) {
                    uniqueUsersToday.add(userId);
                }
            });

            // Update the daily stats
            await collection.updateOne(
                { command, 'dailyStats.date': date },
                { $set: { [`dailyStats.$.uniqueUsers`]: uniqueUsersToday.size } }
            );
        } catch (error) {
            logger.error(`Error updating unique users for ${command} on ${date}:`, error);
        }
    }

    /**
     * Get usage statistics for all commands
     * @param {Object} options - Query options
     * @returns {Promise<Array>} Array of command usage stats
     */
    static async getAllCommandStats(options = {}) {
        try {
            const collection = await this.getCollection();
            const { sortBy = 'totalUsage', order = -1, limit = 50 } = options;

            const pipeline = [
                {
                    $addFields: {
                        uniqueUsers: { $size: { $objectToArray: '$userUsage' } },
                        avgUsagePerUser: {
                            $cond: {
                                if: { $gt: [{ $size: { $objectToArray: '$userUsage' } }, 0] },
                                then: { $divide: ['$totalUsage', { $size: { $objectToArray: '$userUsage' } }] },
                                else: 0
                            }
                        }
                    }
                },
                { $sort: { [sortBy]: order } },
                { $limit: limit }
            ];

            return await collection.aggregate(pipeline).toArray();
        } catch (error) {
            logger.error('Error getting command stats:', error);
            return [];
        }
    }

    /**
     * Get usage statistics for a specific command
     * @param {string} command - Command name
     * @returns {Promise<Object|null>} Command usage stats
     */
    static async getCommandStats(command) {
        try {
            const collection = await this.getCollection();
            
            const result = await collection.aggregate([
                { $match: { command } },
                {
                    $addFields: {
                        uniqueUsers: { $size: { $objectToArray: '$userUsage' } },
                        avgUsagePerUser: {
                            $cond: {
                                if: { $gt: [{ $size: { $objectToArray: '$userUsage' } }, 0] },
                                then: { $divide: ['$totalUsage', { $size: { $objectToArray: '$userUsage' } }] },
                                else: 0
                            }
                        }
                    }
                }
            ]).toArray();

            return result[0] || null;
        } catch (error) {
            logger.error(`Error getting stats for command ${command}:`, error);
            return null;
        }
    }

    /**
     * Get top users by command usage
     * @param {string} command - Command name (optional)
     * @param {number} limit - Number of users to return
     * @returns {Promise<Array>} Array of top users
     */
    static async getTopUsers(command = null, limit = 10) {
        try {
            const collection = await this.getCollection();
            
            if (command) {
                // Get top users for a specific command
                const doc = await collection.findOne({ command });
                if (!doc || !doc.userUsage) return [];

                return Object.entries(doc.userUsage)
                    .map(([userId, userData]) => ({
                        userId,
                        username: userData.username,
                        count: userData.count,
                        lastUsed: userData.lastUsed
                    }))
                    .sort((a, b) => b.count - a.count)
                    .slice(0, limit);
            } else {
                // Get top users across all commands
                const pipeline = [
                    { $project: { command: 1, userUsage: { $objectToArray: '$userUsage' } } },
                    { $unwind: '$userUsage' },
                    {
                        $group: {
                            _id: '$userUsage.k', // userId
                            totalUsage: { $sum: '$userUsage.v.count' },
                            username: { $first: '$userUsage.v.username' },
                            lastUsed: { $max: '$userUsage.v.lastUsed' }
                        }
                    },
                    { $sort: { totalUsage: -1 } },
                    { $limit: limit },
                    {
                        $project: {
                            userId: '$_id',
                            username: 1,
                            totalUsage: 1,
                            lastUsed: 1,
                            _id: 0
                        }
                    }
                ];

                return await collection.aggregate(pipeline).toArray();
            }
        } catch (error) {
            logger.error('Error getting top users:', error);
            return [];
        }
    }

    /**
     * Get usage statistics for a specific time period
     * @param {string} startDate - Start date (YYYY-MM-DD)
     * @param {string} endDate - End date (YYYY-MM-DD)
     * @returns {Promise<Object>} Usage statistics for the period
     */
    static async getUsageByPeriod(startDate, endDate) {
        try {
            const collection = await this.getCollection();
            
            const pipeline = [
                { $unwind: '$dailyStats' },
                {
                    $match: {
                        'dailyStats.date': {
                            $gte: startDate,
                            $lte: endDate
                        }
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalCommands: { $sum: '$dailyStats.count' },
                        totalUniqueUsers: { $sum: '$dailyStats.uniqueUsers' },
                        avgCommandsPerDay: { $avg: '$dailyStats.count' },
                        commandBreakdown: {
                            $push: {
                                command: '$command',
                                count: '$dailyStats.count',
                                date: '$dailyStats.date'
                            }
                        }
                    }
                }
            ];

            const result = await collection.aggregate(pipeline).toArray();
            return result[0] || {
                totalCommands: 0,
                totalUniqueUsers: 0,
                avgCommandsPerDay: 0,
                commandBreakdown: []
            };
        } catch (error) {
            logger.error('Error getting usage by period:', error);
            return null;
        }
    }

    /**
     * Clean up old daily stats (keep last 90 days)
     * @returns {Promise<number>} Number of cleaned records
     */
    static async cleanupOldStats() {
        try {
            const collection = await this.getCollection();
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - 90);
            const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

            const result = await collection.updateMany(
                {},
                {
                    $pull: {
                        dailyStats: {
                            date: { $lt: cutoffDateStr }
                        }
                    }
                }
            );

            logger.info(`Cleaned up old daily stats: ${result.modifiedCount} documents updated`);
            return result.modifiedCount;
        } catch (error) {
            logger.error('Error cleaning up old stats:', error);
            return 0;
        }
    }
}

module.exports = CommandUsageService;