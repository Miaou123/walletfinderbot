const logger = require('../../utils/logger');

class PingHandler {
    constructor() {
    }

    // Méthode principale qui sera appelée par le système de commandes
    async handleCommand(bot, msg, args)  {  // Ajout du paramètre args même si non utilisé
        const chatId = msg.chat.id;
        const startTime = Date.now();

        try {
            logger.debug('Handling ping command for chatId:', chatId);
            
            // Send initial message
            const sentMsg = await bot.sendMessage(
                chatId,
                '🏓 Pinging...'
            );

            // Calculate round trip time
            const endTime = Date.now();
            const roundTripTime = endTime - startTime;

            // Edit the message with the results
            await bot.editMessageText(
                `🏓 Pong!\n\n` +
                `📊 Response time: ${roundTripTime}ms\n` +
                `🤖 Bot Status: Online`,
                {
                    chat_id: chatId,
                    message_id: sentMsg.message_id
                }
            );

        } catch (error) {
            logger.error('Error in ping command:', error);
            if (chatId) {
                await this.bot.sendMessage(
                    chatId,
                    "❌ An error occurred while checking bot status."
                );
            }
        }
    }
}

module.exports = PingHandler;