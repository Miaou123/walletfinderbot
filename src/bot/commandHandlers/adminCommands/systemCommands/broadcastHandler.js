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

            const elapsedTime = Math.floor((Date.now() - startTime) / 1000);
            const minutes = Math.floor(elapsedTime / 60);
            const seconds = elapsedTime % 60;
            
            // Update the status message with final results
            try {
                await this.bot.editMessageText(
                    `📢 Broadcast Complete ✅\n` +
                    `✅ Successfully sent: ${successCount}\n` +
                    `❌ Failed: ${failCount}\n` +
                    `⏱️ Time taken: ${minutes}m ${seconds}s\n` +
                    `🛑 Rate limit hits: ${rateLimitErrors}`,
                    {
                        chat_id: chatId,
                        message_id: statusMsgId
                    }
                );
            } catch (e) {
                // If editing fails, send a new message
                logger.warn('Could not update final status message:', e.message);
                await this.bot.sendMessage(
                    chatId,
                    `📢 Broadcast Results:\n` +
                    `✅ Successfully sent: ${successCount}\n` +
                    `❌ Failed: ${failCount}\n` +
                    `⏱️ Time taken: ${minutes}m ${seconds}s\n` +
                    `🛑 Rate limit hits: ${rateLimitErrors}`
                );
            }
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
        let rateLimitErrors = 0;
        let startTime = Date.now();
        
        const debugInfo = {
            adminStatus: {
                foundInDB: false,
                sentToAdmin: false,
                adminChatId: null
            },
            rateLimit: {
                occurrences: 0,
                lastOccurrence: null
            }
        };

        try {
            const collection = await UserService.getCollection();
            const users = await collection.find({}, { projection: { chatId: 1, username: 1 } }).toArray();

            logger.info(`Retrieved ${users.length} users from DB for broadcasting`);
            
            // Send initial status message
            const statusMsgId = (await this.bot.sendMessage(
                chatId,
                `📢 Starting broadcast to ${users.length} users...`
            )).message_id;
            
            // Track last update time to avoid too many updates
            let lastProgressUpdate = Date.now();
            
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

                        // Add a longer delay to avoid Telegram rate limits (500ms)
                        await new Promise(resolve => setTimeout(resolve, 500));
                        
                        // Add a pause after every 30 messages to avoid hitting Telegram's rate limits
                        if (successCount % 30 === 0) {
                            logger.info(`Pausing for 5 seconds after sending ${successCount} messages...`);
                            
                            // Update progress message approximately every 30 messages (5%)
                            const now = Date.now();
                            if (now - lastProgressUpdate > 5000) {
                                try {
                                    const progress = ((successCount + failCount) / users.length * 100).toFixed(1);
                                    await this.bot.editMessageText(
                                        `📢 Broadcasting in progress...\n` +
                                        `✅ Sent: ${successCount}\n` +
                                        `❌ Failed: ${failCount}\n` +
                                        `📊 Progress: ${progress}% (${successCount + failCount}/${users.length})`,
                                        {
                                            chat_id: chatId,
                                            message_id: statusMsgId
                                        }
                                    );
                                    lastProgressUpdate = now;
                                } catch (e) {
                                    // Ignore edit message errors
                                    logger.warn('Could not update progress message:', e.message);
                                }
                            }
                            
                            await new Promise(resolve => setTimeout(resolve, 5000));
                        }
                    } catch (error) {
                        failCount++;
                        
                        // Check if it's a rate limit error (retry later error)
                        const isRateLimit = error.message && (
                            error.message.includes('429') || 
                            error.message.includes('retry') || 
                            error.message.includes('too many requests') ||
                            error.message.includes('flood')
                        );
                        
                        if (isRateLimit) {
                            rateLimitErrors++;
                            debugInfo.rateLimit.occurrences++;
                            debugInfo.rateLimit.lastOccurrence = Date.now();
                            
                            logger.warn(
                                `Rate limit detected when sending to ${user.username} (${chatIdNum}). ` +
                                `This is occurrence #${rateLimitErrors}. Adding extra pause...`
                            );
                            
                            // Add extra delay when we hit rate limits
                            await new Promise(resolve => setTimeout(resolve, 15000));
                        } else {
                            logger.error(
                                `Failed to send broadcast to user ${user.username} (${chatIdNum}):`,
                                error.message || error
                            );
                        }
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