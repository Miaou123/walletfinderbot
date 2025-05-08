const BaseHandler = require('./baseHandler');

/**
 * Handler for the /ping command
 * Used to check if the bot is responsive
 */
class PingHandler extends BaseHandler {
    constructor() {
        super();
    }

    /**
     * Handle the ping command
     * @param {Object} bot - The telegram bot instance
     * @param {Object} msg - The message object from Telegram
     * @param {Array} args - Command arguments (not used for ping)
     * @param {number|undefined} messageThreadId - The message thread ID if applicable
     */
    async handleCommand(bot, msg, args, messageThreadId) {
        const chatId = msg.chat.id;
        const startTime = Date.now();

        try {
            this.logger.debug('Handling ping command for chatId:', chatId);
            
            // Send initial message
            const sentMsg = await bot.sendMessage(
                chatId,
                '🏓 Pinging...',
                { message_thread_id: messageThreadId }
            );

            // Calculate round trip time
            const endTime = Date.now();
            const roundTripTime = endTime - startTime;
            
            // Get memory usage statistics
            const memoryUsage = process.memoryUsage();
            const heapUsed = Math.round(memoryUsage.heapUsed / 1024 / 1024 * 100) / 100;
            const rssUsed = Math.round(memoryUsage.rss / 1024 / 1024 * 100) / 100;

            // Edit the message with the results
            await bot.editMessageText(
                `🏓 Pong!\n\n` +
                `📊 Response time: ${roundTripTime}ms\n` +
                `💾 Memory: ${heapUsed}MB / ${rssUsed}MB\n` +
                `🤖 Bot Status: Online`,
                {
                    chat_id: chatId,
                    message_id: sentMsg.message_id,
                    message_thread_id: messageThreadId
                }
            );

        } catch (error) {
            this.logger.error('Error in ping command:', error);
            await this.sendMessage(
                bot, 
                chatId,
                "❌ An error occurred while checking bot status.",
                { message_thread_id: messageThreadId }
            );
        }
    }
}

module.exports = PingHandler;