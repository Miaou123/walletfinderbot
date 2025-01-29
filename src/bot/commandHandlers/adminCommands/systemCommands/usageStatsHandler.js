// src/bot/commandHandlers/adminCommands/systemCommands/usageStatsHandler.js

const BaseAdminHandler = require('../baseAdminHandler');
const logger = require('../../../../utils/logger');

class UsageStatsHandler extends BaseAdminHandler {
    constructor(accessControl, bot, usageTracker) {
        super(accessControl, bot);
        this.usageTracker = usageTracker;
    }

    async handle(msg) {
        const chatId = String(msg.chat.id);
        const userId = msg.from.id;

        try {
            if (!await this.checkAdmin(userId)) {
                return;
            }

            const stats = this.usageTracker.getUsageStats();
            if (!stats || Object.keys(stats).length === 0) {
                await this.bot.sendMessage(
                    chatId,
                    "📊 No usage statistics available yet."
                );
                return;
            }

            let message = "📊 Command Usage Statistics:\n\n";
            
            // Trier les commandes par nombre d'utilisations (décroissant)
            const sortedStats = Object.entries(stats)
                .sort(([, a], [, b]) => b - a);

            let totalUses = 0;
            for (const [command, count] of sortedStats) {
                message += `/${command}: ${count} uses\n`;
                totalUses += count;
            }

            message += `\n📈 Total commands used: ${totalUses}`;
            message += `\n👥 Unique commands: ${sortedStats.length}`;

            await this.bot.sendMessage(chatId, message);
        } catch (error) {
            logger.error('Error in usagestats command:', error);
            await this.bot.sendMessage(
                chatId,
                "❌ An error occurred while fetching usage statistics."
            );
        }
    }
}

module.exports = UsageStatsHandler;