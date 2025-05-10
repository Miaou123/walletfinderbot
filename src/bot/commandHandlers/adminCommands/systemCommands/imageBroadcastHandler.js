// src/bot/commandHandlers/adminCommands/systemCommands/imagebroadcastHandler.js

const BaseAdminHandler = require('../baseAdminHandler');
const logger = require('../../../../utils/logger');
const { UserService } = require('../../../../database');

class ImageBroadcastHandler extends BaseAdminHandler {
    constructor(accessControl, bot) {
        super(accessControl, bot);
        this.pendingBroadcasts = new Map();
    }

    async handle(msg, args) {
        const chatId = String(msg.chat.id);
        const userId = String(msg.from.id);
        const username = msg.from.username;

        try {
            if (!await this.checkAdmin(userId)) {
                return;
            }

            // Determine if this is a local test or real broadcast
            const isLocal = msg.text.toLowerCase().startsWith('/imagebroadcastlocal');
            
            logger.info(`Starting ${isLocal ? 'local' : 'real'} image broadcast setup for user ${userId}`);

            // Initialize the broadcast state
            this.pendingBroadcasts.set(userId, {
                type: isLocal ? 'local' : 'real',
                step: 'awaiting_caption',
                caption: '',
                imageId: null,
                chatId: chatId
            });

            // Send instructions
            await this.bot.sendMessage(
                chatId,
                "📸 <b>Image Broadcast Setup</b>\n\n" +
                "I'll guide you through creating an image broadcast.\n\n" +
                "<b>Step 1:</b> Please send the caption text for your image.\n" +
                "You can use HTML formatting like <b>bold</b>, <i>italic</i>, or <code>code</code>.\n\n" +
                "<i>Note: Telegram has a 1024 character limit for captions.</i>\n\n" +
                "Type /cancel at any time to abort this process.",
                { parse_mode: 'HTML' }
            );

            // Set up a one-time listener for this user
            this._setupMessageListener(userId);

        } catch (error) {
            logger.error('Error starting image broadcast setup:', error);
            await this.bot.sendMessage(
                chatId,
                "❌ An error occurred while setting up the image broadcast."
            );
        }
    }

    _setupMessageListener(userId) {
        // Create a message listener for this user
        const messageHandler = async (msg) => {
            // Only process messages from the user who initiated the broadcast
            if (msg.from.id.toString() !== userId) return;
            
            const chatId = String(msg.chat.id);
            const state = this.pendingBroadcasts.get(userId);
            
            // If no state exists, ignore the message
            if (!state) return;
            
            try {
                // Check for cancel command
                if (msg.text && msg.text.toLowerCase() === '/cancel') {
                    // Clean up and remove listener
                    this.pendingBroadcasts.delete(userId);
                    this.bot.removeListener('message', messageHandler);
                    
                    await this.bot.sendMessage(
                        chatId,
                        "✅ Image broadcast setup cancelled."
                    );
                    return;
                }
                
                // Handle based on the current step
                if (state.step === 'awaiting_caption') {
                    if (!msg.text) {
                        await this.bot.sendMessage(
                            chatId,
                            "Please send a text message for the caption. Try again or type /cancel to abort."
                        );
                        return;
                    }
                    
                    // Check caption length
                    if (msg.text.length > 1000) {
                        await this.bot.sendMessage(
                            chatId,
                            "⚠️ Your caption is too long for Telegram image captions (limit: 1024 characters).\n\n" +
                            "Please send a shorter caption (under 1000 characters)."
                        );
                        return;
                    }
                    
                    // Save caption and move to next step
                    state.caption = msg.text;
                    state.step = 'awaiting_image';
                    this.pendingBroadcasts.set(userId, state);
                    
                    await this.bot.sendMessage(
                        chatId,
                        "✅ Caption received!\n\n" +
                        "<b>Step 2:</b> Now, please send the image you want to broadcast.",
                        { parse_mode: 'HTML' }
                    );
                }
                else if (state.step === 'awaiting_image') {
                    if (!msg.photo || msg.photo.length === 0) {
                        await this.bot.sendMessage(
                            chatId,
                            "Please send an image. Try again or type /cancel to abort."
                        );
                        return;
                    }
                    
                    // Get the highest resolution photo
                    const photo = msg.photo[msg.photo.length - 1];
                    const fileId = photo.file_id;
                    
                    // Save file ID
                    state.imageId = fileId;
                    state.step = 'confirming';
                    this.pendingBroadcasts.set(userId, state);
                    
                    // Preview the broadcast
                    await this.bot.sendPhoto(
                        chatId,
                        fileId,
                        {
                            caption: state.caption,
                            parse_mode: 'HTML'
                        }
                    );
                    
                    if (state.type === 'local') {
                        // Local test only
                        await this.bot.sendMessage(
                            chatId,
                            "✅ This is how your image broadcast will look.\n\n" +
                            "To send a real broadcast to all users, use /imagebroadcast."
                        );
                        
                        // Clean up
                        this.pendingBroadcasts.delete(userId);
                        this.bot.removeListener('message', messageHandler);
                    }
                    else {
                        // Real broadcast - ask for confirmation
                        await this.bot.sendMessage(
                            chatId,
                            "👆 This is how your broadcast will look.\n\n" +
                            "<b>Step 3:</b> Are you sure you want to send this to ALL users?\n\n" +
                            "Reply with 'CONFIRM' to proceed or 'CANCEL' to abort.",
                            { parse_mode: 'HTML' }
                        );
                    }
                }
                else if (state.step === 'confirming') {
                    if (!msg.text) {
                        await this.bot.sendMessage(
                            chatId,
                            "Please reply with 'CONFIRM' to proceed or 'CANCEL' to abort."
                        );
                        return;
                    }
                    
                    if (msg.text.toUpperCase() === 'CONFIRM') {
                        // Get image and caption info before cleaning up state
                        const imageId = state.imageId;
                        const caption = state.caption;
                        
                        // Clean up the state first
                        this.pendingBroadcasts.delete(userId);
                        this.bot.removeListener('message', messageHandler);
                        
                        // Start actual broadcast
                        await this._broadcastToAllUsers(userId, imageId, caption, chatId);
                    }
                    else if (msg.text.toUpperCase() === 'CANCEL') {
                        await this.bot.sendMessage(
                            chatId,
                            "✅ Broadcast cancelled."
                        );
                        
                        // Clean up
                        this.pendingBroadcasts.delete(userId);
                        this.bot.removeListener('message', messageHandler);
                    }
                    else {
                        await this.bot.sendMessage(
                            chatId,
                            "Please reply with 'CONFIRM' to proceed or 'CANCEL' to abort."
                        );
                        return;
                    }
                }
            }
            catch (error) {
                logger.error('Error in image broadcast flow:', error);
                await this.bot.sendMessage(
                    chatId,
                    "❌ An error occurred during the image broadcast setup:\n\n" +
                    error.message + "\n\n" +
                    "The image broadcast has been cancelled."
                );
                
                // Clean up on error
                this.pendingBroadcasts.delete(userId);
                this.bot.removeListener('message', messageHandler);
            }
        };
        
        // Add listener
        this.bot.on('message', messageHandler);
    }

    async _broadcastToAllUsers(userId, imageId, caption, chatId) {
        try {
            const collection = await UserService.getCollection();
            const users = await collection.find({}, { projection: { chatId: 1, username: 1 } }).toArray();

            logger.info(`Retrieved ${users.length} users from DB for broadcasting`);
            
            // Send initial status message
            const statusMsg = await this.bot.sendMessage(
                chatId,
                `📢 Starting image broadcast to ${users.length} users...`
            );
            const statusMsgId = statusMsg.message_id;
            
            // Track progress stats
            let successCount = 0;
            let failCount = 0;
            let rateLimitErrors = 0;
            let startTime = Date.now();
            let lastProgressUpdate = Date.now();
            
            for (const user of users) {
                const userChatId = Number(user.chatId);
                const username = user.username || 'unknown';
                
                if (userChatId > 0) {
                    try {
                        // Send the image with caption
                        await this.bot.sendPhoto(
                            userChatId,
                            imageId,
                            {
                                caption: caption,
                                parse_mode: 'HTML'
                            }
                        );
                        
                        successCount++;
                        logger.info(`Successfully sent image broadcast to user ${username} (${userChatId})`);
                        
                        // Add a longer delay to avoid Telegram rate limits (500ms)
                        await new Promise(resolve => setTimeout(resolve, 500));
                        
                        // Add a pause after every 30 messages to avoid hitting Telegram's rate limits
                        if (successCount % 30 === 0) {
                            logger.info(`Pausing for 5 seconds after sending ${successCount} messages...`);
                            
                            // Update progress message approximately every 30 messages
                            const now = Date.now();
                            if (now - lastProgressUpdate > 5000) {
                                try {
                                    const progress = ((successCount + failCount) / users.length * 100).toFixed(1);
                                    const elapsedSecs = Math.floor((now - startTime) / 1000);
                                    const mins = Math.floor(elapsedSecs / 60);
                                    const secs = elapsedSecs % 60;
                                    
                                    await this.bot.editMessageText(
                                        `📢 Image broadcasting in progress...\n` +
                                        `✅ Sent: ${successCount}\n` +
                                        `❌ Failed: ${failCount}\n` +
                                        `⏱️ Time: ${mins}m ${secs}s\n` +
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
                        
                        // Check if it's a rate limit error
                        const isRateLimit = error.message && (
                            error.message.includes('429') || 
                            error.message.includes('retry') || 
                            error.message.includes('too many requests') ||
                            error.message.includes('flood')
                        );
                        
                        if (isRateLimit) {
                            rateLimitErrors++;
                            
                            logger.warn(
                                `Rate limit detected when sending to ${username} (${userChatId}). ` +
                                `This is occurrence #${rateLimitErrors}. Adding extra pause...`
                            );
                            
                            // Add extra delay when we hit rate limits
                            await new Promise(resolve => setTimeout(resolve, 15000));
                        } else {
                            logger.error(
                                `Failed to send image broadcast to user ${username} (${userChatId}):`,
                                error.message || error
                            );
                        }
                    }
                } else {
                    logger.info(`Skipping user ${username} - invalid chatId`);
                }
            }

            // Calculate final stats
            const elapsedTime = Math.floor((Date.now() - startTime) / 1000);
            const minutes = Math.floor(elapsedTime / 60);
            const seconds = elapsedTime % 60;
            
            // Update the status message with final results
            try {
                await this.bot.editMessageText(
                    `📢 Image Broadcast Complete ✅\n` +
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
                    `📢 Image Broadcast Results:\n` +
                    `✅ Successfully sent: ${successCount}\n` +
                    `❌ Failed: ${failCount}\n` +
                    `⏱️ Time taken: ${minutes}m ${seconds}s\n` +
                    `🛑 Rate limit hits: ${rateLimitErrors}`
                );
            }

            logger.info(`Image broadcast complete. Successful: ${successCount}, Failed: ${failCount}`);
            
        } catch (error) {
            logger.error('Error in image broadcast:', error);
            await this.bot.sendMessage(
                chatId,
                `❌ Error during image broadcast: ${error.message}`
            );
        }
    }
}

module.exports = ImageBroadcastHandler;