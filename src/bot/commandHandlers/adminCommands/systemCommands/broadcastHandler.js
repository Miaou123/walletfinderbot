// src/bot/commandHandlers/adminCommands/systemCommands/broadcastHandler.js

const BaseAdminHandler = require('../baseAdminHandler');
const logger = require('../../../../utils/logger');
const { UserService } = require('../../../../database');

class BroadcastHandler extends BaseAdminHandler {
    constructor(accessControl, bot) {
        super(accessControl, bot);
    }

    async handle(msg, args) {
        const chatId = String(msg.chat.id);
        const userId = msg.from.id;

        try {
            if (!await this.checkAdmin(userId)) {
                return;
            }

            const fullMessage = args.join(' ');
            if (!fullMessage) {
                await this.bot.sendMessage(
                    chatId,
                    "Usage: /broadcast <message>\nPlease provide a message to broadcast."
                );
                return;
            }

            const { successCount, failCount } = await this.broadcastMessage(fullMessage);
            await this.bot.sendMessage(
                chatId, 
                `📢 Broadcast Results:\n` +
                `✅ Successfully sent: ${successCount}\n` +
                `❌ Failed: ${failCount}`
            );
        } catch (error) {
            logger.error('Error in broadcast:', error.message || error);
            await this.bot.sendMessage(
                chatId, 
                "❌ An error occurred while broadcasting the message."
            );
        }
    }

    async broadcastMessage(message) {
        logger.info('Starting broadcast');
        
        try {
            // Obtenir la collection des utilisateurs via UserService
            const collection = await UserService.getCollection();
            const users = await collection.find(
                {}, 
                { projection: { chatId: 1, username: 1 } }
            ).toArray();

            logger.info(`Retrieved ${users.length} users for broadcasting`);
            
            let successCount = 0;
            let failCount = 0;

            for (const user of users) {
                // Vérifier si l'utilisateur a un chatId valide
                if (user.chatId && Number(user.chatId) > 0) {
                    try {
                        logger.info(`Attempting to send message to user ${user.username} (${user.chatId})`);
                        await this.bot.sendMessage(user.chatId, message, {
                            parse_mode: 'HTML',
                            disable_web_page_preview: true
                        });
                        successCount++;
                        logger.info(`Successfully sent broadcast to user ${user.username}`);
                        
                        // Délai pour éviter les limites de rate de Telegram
                        await new Promise(resolve => setTimeout(resolve, 100));
                    } catch (error) {
                        failCount++;
                        logger.error(
                            `Failed to send broadcast to user ${user.username}:`,
                            error.message || error
                        );
                    }
                } else {
                    logger.warn(`Skipping user ${user.username} - No valid chat ID`);
                }
            }

            logger.info(`Broadcast complete. Successful: ${successCount}, Failed: ${failCount}`);
            return { successCount, failCount };
        } catch (error) {
            logger.error('Error retrieving users for broadcast:', error);
            throw error;
        }
    }
}

module.exports = BroadcastHandler;