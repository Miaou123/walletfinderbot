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
        const adminUsername = msg.from.username;

        try {
            if (!await this.checkAdmin(userId)) {
                return;
            }

            const commandLength = '/broadcast '.length;
            const fullMessage = msg.text.slice(commandLength);

            if (!fullMessage) {
                await this.bot.sendMessage(
                    chatId,
                    "Usage: /broadcast <message>\nPlease provide a message to broadcast."
                );
                return;
            }

            const { successCount, failCount, debugInfo } = await this.broadcastMessage(fullMessage, adminUsername);
            
            // Send detailed debug info only to admin
            if (debugInfo.adminStatus) {
                await this.bot.sendMessage(
                    chatId,
                    `🔍 Admin Debug Info:\n` +
                    `Admin username: ${adminUsername}\n` +
                    `Admin chatId: ${debugInfo.adminStatus.adminChatId}\n` +
                    `Found in DB: ${debugInfo.adminStatus.foundInDB}\n` +
                    `Sent to admin: ${debugInfo.adminStatus.sentToAdmin}`
                );
            }

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

    async broadcastMessage(message, adminUsername) {
        logger.info('Starting broadcast');

        let successCount = 0;
        let failCount = 0;
        const debugInfo = {
            adminStatus: {
                foundInDB: false,
                sentToAdmin: false,
                adminChatId: null
            }
        };

        try {
            const collection = await UserService.getCollection();
            const users = await collection.find({}, { projection: { chatId: 1, username: 1 } }).toArray();

            logger.info(`Retrieved ${users.length} users from DB for broadcasting`);

            for (const user of users) {
                const chatIdNum = Number(user.chatId);
                const normalizedUsername = user.username ? user.username.toLowerCase() : null;

                // Check if this is the admin
                if (normalizedUsername === adminUsername?.toLowerCase()) {
                    debugInfo.adminStatus.foundInDB = true;
                    debugInfo.adminStatus.adminChatId = chatIdNum;
                    logger.info(`Found admin in DB: ${user.username} with chatId: ${chatIdNum}`);
                }

                if (chatIdNum > 0 && normalizedUsername) {
                    try {
                        await this.bot.sendMessage(chatIdNum, message, {
                            parse_mode: 'HTML',
                            disable_web_page_preview: true
                        });

                        successCount++;
                        logger.info(`Successfully sent broadcast to user ${user.username} (${chatIdNum})`);

                        if (normalizedUsername === adminUsername?.toLowerCase()) {
                            debugInfo.adminStatus.sentToAdmin = true;
                        }

                        // Délai pour éviter les limites de rate de Telegram
                        await new Promise(resolve => setTimeout(resolve, 100));
                    } catch (error) {
                        failCount++;
                        logger.error(
                            `Failed to send broadcast to user ${user.username} (${chatIdNum}):`,
                            error.message || error
                        );
                    }
                } else {
                    logger.info(`Skipping user ${user.username} - invalid chatId or no username`);
                }
            }

            logger.info(`Broadcast complete. Successful: ${successCount}, Failed: ${failCount}`);
            logger.info(`Admin status: ${JSON.stringify(debugInfo.adminStatus, null, 2)}`);
            
            return { successCount, failCount, debugInfo };
        } catch (error) {
            logger.error('Error retrieving or sending broadcast:', error);
            throw error;
        }
    }
}

module.exports = BroadcastHandler;