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

        logger.info(`Broadcast handler called by user ${userId} (${adminUsername})`);
        
        try {
            // Log the admin check
            logger.info(`Checking if user ${userId} is an admin`);
            const isAdmin = await this.checkAdmin(userId);
            if (!isAdmin) {
                logger.warn(`User ${userId} (${adminUsername}) is not an admin but tried to broadcast`);
                return;
            }
            logger.info(`Admin check passed for user ${userId}`);

            const commandLength = '/broadcast '.length;
            const fullMessage = msg.text.slice(commandLength);
            
            logger.debug(`Message content length: ${fullMessage.length} characters`);

            if (!fullMessage) {
                logger.info(`User ${userId} attempted broadcast with empty message`);
                await this.bot.sendMessage(
                    chatId,
                    "Usage: /broadcast <message>\nPlease provide a message to broadcast."
                );
                return;
            }

            // Initialize variables here since they're used later
            let statusMsgId, startTime;
            let rateLimitErrors = 0;
            
            // Send initial status message to track progress
            try {
                logger.info(`Sending initial status message to ${chatId}`);
                const statusMsg = await this.bot.sendMessage(
                    chatId,
                    `📢 Preparing broadcast...`
                );
                statusMsgId = statusMsg.message_id;
                logger.info(`Initial status message sent, ID: ${statusMsgId}`);
            } catch (error) {
                logger.error(`Failed to send initial status message: ${error.message}`);
                throw new Error(`Could not send initial status message: ${error.message}`);
            }
            
            // Start the broadcast
            startTime = Date.now();
            logger.info(`Starting broadcast process at ${new Date(startTime).toISOString()}`);
            
            const { successCount, failCount, debugInfo, rateLimitHits } = await this.broadcastMessage(
                fullMessage, adminUsername, chatId, statusMsgId
            );
            
            // Update the rate limit errors count for the status message
            rateLimitErrors = rateLimitHits || 0;
            logger.info(`Broadcast completed with ${successCount} successes, ${failCount} failures`);
            
            // Send detailed debug info only to admin
            if (debugInfo.adminStatus) {
                logger.info(`Sending debug info to admin ${userId}`);
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
                logger.info(`Updating final status message ${statusMsgId} in chat ${chatId}`);
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
                logger.info(`Final status message updated successfully`);
            } catch (e) {
                // If editing fails, send a new message
                logger.warn(`Could not update final status message: ${e.message}`);
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

    async broadcastMessage(message, adminUsername, chatId, statusMsgId) {
        logger.info('Starting broadcast process');

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
            logger.info('Connecting to database to retrieve users');
            let collection;
            try {
                collection = await UserService.getCollection();
                logger.info('Successfully connected to users collection');
            } catch (dbError) {
                logger.error(`Database connection error: ${dbError.message}`, { stack: dbError.stack });
                throw new Error(`Failed to connect to database: ${dbError.message}`);
            }
            
            logger.info('Fetching users from database');
            let users;
            try {
                users = await collection.find({}, { projection: { chatId: 1, username: 1 } }).toArray();
                logger.info(`Successfully retrieved ${users.length} users from database`);
            } catch (queryError) {
                logger.error(`Error querying users: ${queryError.message}`, { stack: queryError.stack });
                throw new Error(`Failed to query users: ${queryError.message}`);
            }

            // Update the status message with user count
            try {
                logger.info(`Updating status message with user count: ${users.length}`);
                await this.bot.editMessageText(
                    `📢 Starting broadcast to ${users.length} users...`,
                    {
                        chat_id: chatId,
                        message_id: statusMsgId
                    }
                );
            } catch (updateError) {
                logger.warn(`Could not update status message with user count: ${updateError.message}`);
                // Continue anyway, not critical
            }
            
            // Track last update time to avoid too many updates
            let lastProgressUpdate = Date.now();
            
            logger.info(`Processing ${users.length} users for broadcast`);
            let processedCount = 0;
            
            for (const user of users) {
                processedCount++;
                const chatIdNum = Number(user.chatId);
                const normalizedUsername = user.username ? user.username.toLowerCase() : null;

                // Check if this is the admin
                if (normalizedUsername === adminUsername?.toLowerCase()) {
                    debugInfo.adminStatus.foundInDB = true;
                    debugInfo.adminStatus.adminChatId = chatIdNum;
                    logger.info(`Found admin in DB: ${user.username} with chatId: ${chatIdNum}`);
                }

                // Log skipped users
                if (!chatIdNum || chatIdNum <= 0) {
                    logger.info(`Skipping user with invalid chatId: ${user.chatId}`);
                    continue;
                }
                
                if (!normalizedUsername) {
                    logger.info(`Skipping user with no username, chatId: ${chatIdNum}`);
                    continue;
                }

                // Try to send message
                try {
                    logger.debug(`Attempting to send message to user ${user.username} (${chatIdNum})`);
                    await this.bot.sendMessage(chatIdNum, message, {
                        parse_mode: 'HTML',
                        disable_web_page_preview: true
                    });

                    successCount++;
                    logger.info(`Successfully sent broadcast to user ${user.username} (${chatIdNum})`);

                    if (normalizedUsername === adminUsername?.toLowerCase()) {
                        debugInfo.adminStatus.sentToAdmin = true;
                        logger.info(`Successfully sent broadcast to admin ${adminUsername}`);
                    }

                    // Add a longer delay to avoid Telegram rate limits (500ms)
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    // Add a pause after every 30 messages to avoid hitting Telegram's rate limits
                    if (successCount % 30 === 0) {
                        logger.info(`Pausing for 5 seconds after sending ${successCount} messages...`);
                        
                        // Update progress message approximately every 30 messages
                        const now = Date.now();
                        if (now - lastProgressUpdate > 5000) {
                            try {
                                const progress = (processedCount / users.length * 100).toFixed(1);
                                logger.info(`Updating progress: ${progress}%`);
                                await this.bot.editMessageText(
                                    `📢 Broadcasting in progress...\n` +
                                    `✅ Sent: ${successCount}\n` +
                                    `❌ Failed: ${failCount}\n` +
                                    `📊 Progress: ${progress}% (${processedCount}/${users.length})`,
                                    {
                                        chat_id: chatId,
                                        message_id: statusMsgId
                                    }
                                );
                                lastProgressUpdate = now;
                            } catch (e) {
                                // Ignore edit message errors
                                logger.warn(`Could not update progress message: ${e.message}`);
                            }
                        }
                        
                        logger.info('Starting 5 second pause to avoid rate limits');
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        logger.info('Resuming after pause');
                    }
                } catch (error) {
                    failCount++;
                    
                    // Log the detailed error
                    logger.error(`Error sending to ${user.username} (${chatIdNum}): ${error.message}`, {
                        stack: error.stack,
                        errorCode: error.code,
                        responseBody: error.response?.body
                    });
                    
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
                        logger.info('Starting 15 second pause due to rate limit');
                        await new Promise(resolve => setTimeout(resolve, 15000));
                        logger.info('Resuming after rate limit pause');
                    } else {
                        logger.error(
                            `Failed to send broadcast to user ${user.username} (${chatIdNum}):`,
                            error.message || error
                        );
                    }
                }
            }

            logger.info(`Broadcast complete. Successful: ${successCount}, Failed: ${failCount}, Rate Limits: ${rateLimitErrors}`);
            logger.info(`Admin status: ${JSON.stringify(debugInfo.adminStatus, null, 2)}`);
            
            return { 
                successCount, 
                failCount, 
                debugInfo,
                rateLimitHits: rateLimitErrors 
            };
        } catch (error) {
            logger.error(`Error in broadcastMessage: ${error.message}`, { stack: error.stack });
            throw error;
        }
    }
}

module.exports = BroadcastHandler;