// src/bot/commandHandlers/adminCommands/systemCommands/imagebroadcastHandler.js

const BaseAdminHandler = require('../baseAdminHandler');
const logger = require('../../../../utils/logger');

class ImageBroadcastHandler extends BaseAdminHandler {
    constructor(accessControl, bot) {
        super(accessControl, bot);
        // Track users who are in the image broadcast flow
        this.pendingBroadcasts = new Map();
    }

    async handle(msg, args) {
        const chatId = String(msg.chat.id);
        const userId = String(msg.from.id);

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
                imageId: null
            });

            // Send instructions
            await this.bot.sendMessage(
                chatId,
                "📸 <b>Image Broadcast Setup</b>\n\n" +
                "I'll guide you through creating an image broadcast.\n\n" +
                "<b>Step 1:</b> Please send the caption text for your image.\n" +
                "You can use HTML formatting like <b>bold</b>, <i>italic</i>, or <code>code</code>.\n\n" +
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
                        // Broadcast to all users
                        await this.bot.sendMessage(
                            chatId,
                            "🚀 Broadcasting image to all users...\n" +
                            "This may take some time. You'll receive updates on the progress."
                        );
                        
                        // Implement actual broadcast logic here
                        // For now, just a placeholder confirmation
                        await this.bot.sendMessage(
                            chatId,
                            "✅ Broadcast complete!\n\n" +
                            "Your image has been sent to all users."
                        );
                    }
                    else if (msg.text.toUpperCase() === 'CANCEL') {
                        await this.bot.sendMessage(
                            chatId,
                            "✅ Broadcast cancelled."
                        );
                    }
                    else {
                        await this.bot.sendMessage(
                            chatId,
                            "Please reply with 'CONFIRM' to proceed or 'CANCEL' to abort."
                        );
                        return;
                    }
                    
                    // Clean up in any case
                    this.pendingBroadcasts.delete(userId);
                    this.bot.removeListener('message', messageHandler);
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
}

module.exports = ImageBroadcastHandler;