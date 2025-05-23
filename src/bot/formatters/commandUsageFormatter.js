const { formatNumber } = require('./generalFormatters');
const logger = require('../../utils/logger');

class CommandUsageFormatter {
    /**
     * Format overall command usage statistics
     * @param {Array} commandStats - Array of command statistics
     * @param {string} period - Time period (today, week, month, all)
     * @param {Object} summary - Summary statistics
     * @returns {string} Formatted message
     */
    static formatOverallStats(commandStats, period = 'all', summary = {}) {
        try {
            let message = `<b>📊 Command Usage Statistics</b>\n`;
            message += `<b>Period:</b> ${this.getPeriodDisplay(period)}\n\n`;

            // Summary stats
            if (summary.totalCommands) {
                message += `<b>📈 Summary:</b>\n`;
                message += `• Total Commands: <code>${formatNumber(summary.totalCommands, 0)}</code>\n`;
                message += `• Unique Users: <code>${formatNumber(summary.totalUniqueUsers || 0, 0)}</code>\n`;
                message += `• Avg Commands/Day: <code>${formatNumber(summary.avgCommandsPerDay || 0, 1)}</code>\n\n`;
            }

            if (!commandStats || commandStats.length === 0) {
                message += `<i>No command usage data found for ${period}</i>`;
                return message;
            }

            // Top commands
            message += `<b>🏆 Top Commands (${commandStats.length}):</b>\n`;
            
            commandStats.forEach((cmd, index) => {
                const rank = index + 1;
                const usage = formatNumber(cmd.totalUsage, 0);
                const users = formatNumber(cmd.uniqueUsers || 0, 0);
                const avgPerUser = cmd.avgUsagePerUser ? formatNumber(cmd.avgUsagePerUser, 1) : '0';
                
                message += `${rank}. <code>/${cmd.command}</code>\n`;
                message += `   └ ${usage} uses • ${users} users • ${avgPerUser} avg/user\n`;
            });

            return message;
        } catch (error) {
            logger.error('Error formatting overall stats:', error);
            return 'Error formatting command usage statistics.';
        }
    }

    /**
     * Format statistics for a specific command
     * @param {Object} commandStats - Single command statistics
     * @param {Array} topUsers - Top users for this command
     * @param {string} period - Time period
     * @returns {string} Formatted message
     */
    static formatCommandStats(commandStats, topUsers = [], period = 'all') {
        try {
            if (!commandStats) {
                return `<b>📊 Command Statistics</b>\n\n<i>No data found for the specified command and period.</i>`;
            }

            let message = `<b>📊 Command Statistics: /${commandStats.command}</b>\n`;
            message += `<b>Period:</b> ${this.getPeriodDisplay(period)}\n\n`;

            // Basic stats
            message += `<b>📈 Usage Stats:</b>\n`;
            message += `• Total Uses: <code>${formatNumber(commandStats.totalUsage, 0)}</code>\n`;
            message += `• Unique Users: <code>${formatNumber(commandStats.uniqueUsers || 0, 0)}</code>\n`;
            message += `• Avg Uses/User: <code>${formatNumber(commandStats.avgUsagePerUser || 0, 1)}</code>\n`;
            
            if (commandStats.lastUsed) {
                const lastUsed = new Date(commandStats.lastUsed);
                message += `• Last Used: <code>${this.formatDate(lastUsed)}</code>\n`;
            }

            // Daily breakdown (last 7 days)
            if (commandStats.dailyStats && commandStats.dailyStats.length > 0) {
                message += `\n<b>📅 Recent Activity (Last 7 Days):</b>\n`;
                
                const recentStats = commandStats.dailyStats
                    .slice(-7)
                    .reverse(); // Show most recent first
                
                recentStats.forEach(day => {
                    const date = new Date(day.date);
                    const dayName = this.getDayName(date);
                    message += `• ${dayName}: <code>${formatNumber(day.count, 0)}</code> uses (${formatNumber(day.uniqueUsers || 0, 0)} users)\n`;
                });
            }

            // Top users
            if (topUsers && topUsers.length > 0) {
                message += `\n<b>👥 Top Users:</b>\n`;
                
                topUsers.slice(0, 10).forEach((user, index) => {
                    const rank = index + 1;
                    const displayName = user.username ? `@${user.username}` : `User ${user.userId}`;
                    const lastUsed = user.lastUsed ? this.formatDate(new Date(user.lastUsed)) : 'Unknown';
                    
                    message += `${rank}. ${displayName}\n`;
                    message += `   └ <code>${formatNumber(user.count, 0)}</code> uses • Last: ${lastUsed}\n`;
                });
            }

            return message;
        } catch (error) {
            logger.error('Error formatting command stats:', error);
            return 'Error formatting command statistics.';
        }
    }

    /**
     * Format top users across all commands
     * @param {Array} topUsers - Array of top users
     * @param {string} period - Time period
     * @returns {string} Formatted message
     */
    static formatTopUsers(topUsers, period = 'all') {
        try {
            let message = `<b>👥 Top Users by Command Usage</b>\n`;
            message += `<b>Period:</b> ${this.getPeriodDisplay(period)}\n\n`;

            if (!topUsers || topUsers.length === 0) {
                message += `<i>No user data found for ${period}</i>`;
                return message;
            }

            topUsers.forEach((user, index) => {
                const rank = index + 1;
                const displayName = user.username ? `@${user.username}` : `User ${user.userId}`;
                const lastUsed = user.lastUsed ? this.formatDate(new Date(user.lastUsed)) : 'Unknown';
                
                message += `${rank}. ${displayName}\n`;
                message += `   └ <code>${formatNumber(user.totalUsage, 0)}</code> total uses • Last: ${lastUsed}\n`;
            });

            return message;
        } catch (error) {
            logger.error('Error formatting top users:', error);
            return 'Error formatting top users statistics.';
        }
    }

    /**
     * Get display text for period
     * @param {string} period - Period identifier
     * @returns {string} Display text
     */
    static getPeriodDisplay(period) {
        switch (period) {
            case 'today': return 'Today';
            case 'week': return 'This Week';
            case 'month': return 'This Month';
            case 'all': return 'All Time';
            default: return period;
        }
    }

    /**
     * Format date for display
     * @param {Date} date - Date object
     * @returns {string} Formatted date string
     */
    static formatDate(date) {
        const now = new Date();
        const diffTime = Math.abs(now - date);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays === 1) {
            return 'Today';
        } else if (diffDays === 2) {
            return 'Yesterday';
        } else if (diffDays <= 7) {
            return `${diffDays - 1} days ago`;
        } else {
            return date.toLocaleDateString();
        }
    }

    /**
     * Get day name for date
     * @param {Date} date - Date object
     * @returns {string} Day name
     */
    static getDayName(date) {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        
        if (date.toDateString() === today.toDateString()) {
            return 'Today';
        } else if (date.toDateString() === yesterday.toDateString()) {
            return 'Yesterday';
        } else {
            return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        }
    }
}

module.exports = CommandUsageFormatter;