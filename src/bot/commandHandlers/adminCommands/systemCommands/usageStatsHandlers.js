const CommandUsageService = require('../../../../database/services/commandUsageService');
const CommandUsageFormatter = require('../../../formatters/commandUsageFormatter');
const logger = require('../../../../utils/logger');

class UsageStatsHandlers {
    constructor(bot, accessControl) {
        this.bot = bot;
        this.accessControl = accessControl;
    }

    /**
     * Handle /commandrecap command
     * @param {Object} msg - Telegram message object
     * @param {Array} args - Command arguments
     */
    async handleCommandRecap(msg, args) {
        try {
            const chatId = msg.chat.id;
            const period = args[0] || 'all';
            const specificCommand = args[1];

            // Validate period
            const validPeriods = ['today', 'week', 'month', 'all'];
            if (!validPeriods.includes(period)) {
                await this.bot.sendMessage(chatId, 
                    `❌ Invalid period. Use: ${validPeriods.join(', ')}`
                );
                return;
            }

            // Send loading message
            const loadingMsg = await this.bot.sendMessage(chatId, 
                '📊 Generating command usage statistics...'
            );

            // Calculate date range based on period
            const dateRange = this.getDateRange(period);

            if (specificCommand) {
                // Show stats for specific command
                const commandStats = await CommandUsageService.getCommandStats(specificCommand);
                const topUsers = await CommandUsageService.getTopUsers(specificCommand, 10);
                
                const message = CommandUsageFormatter.formatCommandStats(
                    commandStats, 
                    topUsers, 
                    period
                );
                
                await this.bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id,
                    parse_mode: 'HTML'
                });
            } else {
                // Show overall stats
                const commandStats = await CommandUsageService.getAllCommandStats({
                    sortBy: 'totalUsage',
                    order: -1,
                    limit: 20
                });

                // Get period summary if not all-time
                let summary = {};
                if (period !== 'all') {
                    summary = await CommandUsageService.getUsageByPeriod(
                        dateRange.start, 
                        dateRange.end
                    );
                } else {
                    // Calculate all-time summary
                    const totalCommands = commandStats.reduce((sum, cmd) => sum + cmd.totalUsage, 0);
                    const uniqueUsers = new Set();
                    
                    commandStats.forEach(cmd => {
                        if (cmd.userUsage) {
                            Object.keys(cmd.userUsage).forEach(userId => uniqueUsers.add(userId));
                        }
                    });
                    
                    summary = {
                        totalCommands,
                        totalUniqueUsers: uniqueUsers.size,
                        avgCommandsPerDay: totalCommands / Math.max(1, this.getDaysSinceStart())
                    };
                }

                const message = CommandUsageFormatter.formatOverallStats(
                    commandStats, 
                    period, 
                    summary
                );
                
                await this.bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id,
                    parse_mode: 'HTML'
                });
            }

        } catch (error) {
            logger.error('Error in handleCommandRecap:', error);
            await this.bot.sendMessage(msg.chat.id, 
                '❌ Error generating command usage statistics. Please try again.'
            );
        }
    }

    /**
     * Handle /usagestats command (alias for commandrecap)
     * @param {Object} msg - Telegram message object
     * @param {Array} args - Command arguments
     */
    async handleUsageStats(msg, args) {
        await this.handleCommandRecap(msg, args);
    }

    /**
     * Handle /topusers command - Show top users across all commands
     * @param {Object} msg - Telegram message object
     * @param {Array} args - Command arguments
     */
    async handleTopUsers(msg, args) {
        try {
            const chatId = msg.chat.id;
            const limit = parseInt(args[0]) || 15;
            const period = args[1] || 'all';

            if (limit > 50) {
                await this.bot.sendMessage(chatId, '❌ Maximum limit is 50 users.');
                return;
            }

            const loadingMsg = await this.bot.sendMessage(chatId, 
                '👥 Fetching top users...'
            );

            const topUsers = await CommandUsageService.getTopUsers(null, limit);
            const message = CommandUsageFormatter.formatTopUsers(topUsers, period);

            await this.bot.editMessageText(message, {
                chat_id: chatId,
                message_id: loadingMsg.message_id,
                parse_mode: 'HTML'
            });

        } catch (error) {
            logger.error('Error in handleTopUsers:', error);
            await this.bot.sendMessage(msg.chat.id, 
                '❌ Error fetching top users. Please try again.'
            );
        }
    }

    /**
     * Handle /commandstats command - Show stats for a specific command
     * @param {Object} msg - Telegram message object
     * @param {Array} args - Command arguments
     */
    async handleCommandStats(msg, args) {
        try {
            const chatId = msg.chat.id;
            const command = args[0];

            if (!command) {
                await this.bot.sendMessage(chatId, 
                    '❌ Please specify a command name.\n\nUsage: /commandstats <command>'
                );
                return;
            }

            const loadingMsg = await this.bot.sendMessage(chatId, 
                `📊 Fetching statistics for /${command}...`
            );

            const commandStats = await CommandUsageService.getCommandStats(command);
            const topUsers = await CommandUsageService.getTopUsers(command, 10);

            if (!commandStats) {
                await this.bot.editMessageText(
                    `❌ No statistics found for command: /${command}`, {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id
                });
                return;
            }

            const message = CommandUsageFormatter.formatCommandStats(
                commandStats, 
                topUsers, 
                'all'
            );

            await this.bot.editMessageText(message, {
                chat_id: chatId,
                message_id: loadingMsg.message_id,
                parse_mode: 'HTML'
            });

        } catch (error) {
            logger.error('Error in handleCommandStats:', error);
            await this.bot.sendMessage(msg.chat.id, 
                '❌ Error fetching command statistics. Please try again.'
            );
        }
    }

    /**
     * Get date range based on period
     * @param {string} period - Period identifier
     * @returns {Object} Date range object
     */
    getDateRange(period) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        switch (period) {
            case 'today':
                return {
                    start: today.toISOString().split('T')[0],
                    end: today.toISOString().split('T')[0]
                };
            case 'week':
                const weekStart = new Date(today);
                weekStart.setDate(today.getDate() - today.getDay());
                return {
                    start: weekStart.toISOString().split('T')[0],
                    end: today.toISOString().split('T')[0]
                };
            case 'month':
                const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
                return {
                    start: monthStart.toISOString().split('T')[0],
                    end: today.toISOString().split('T')[0]
                };
            default:
                return { start: null, end: null };
        }
    }

    /**
     * Calculate days since bot started collecting data
     * @returns {number} Number of days
     */
    getDaysSinceStart() {
        // You can adjust this date to when your bot started collecting data
        const botStartDate = new Date('2024-01-01'); // Adjust this date
        const now = new Date();
        const diffTime = Math.abs(now - botStartDate);
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }
}

module.exports = UsageStatsHandlers;