// src/bot/commandHandlers/adminCommands/systemCommands/broadcastLocalHandler.js

const BaseAdminHandler = require('../baseAdminHandler');
const logger = require('../../../../utils/logger');
const fs = require('fs');

class BroadcastLocalHandler extends BaseAdminHandler {
    constructor(accessControl, bot) {
        super(accessControl, bot);
    }

    async handle(msg, args) {
        const chatId = String(msg.chat.id);
        const userId = msg.from.id;
        const username = msg.from.username;

        try {
            if (!await this.checkAdmin(userId)) {
                return;
            }

            // Log full message structure for debugging
            logger.debug('BroadcastLocal message structure:', JSON.stringify(msg, null, 2));

            // Check if a photo is attached
            const hasImage = msg.photo && msg.photo.length > 0;
            logger.debug(`Message has image: ${hasImage}`);
            
            let messageText = "";
            
            if (hasImage) {
                // If there's a photo, get the message text from caption
                messageText = msg.caption || "";
                logger.debug(`Image caption: "${messageText}"`);
                
                // Get the highest resolution image
                const photo = msg.photo[msg.photo.length - 1];
                const fileId = photo.file_id;
                logger.debug(`Photo file_id: ${fileId}`);
                
                try {
                    // Get file path from Telegram
                    logger.debug('Attempting to get file from Telegram...');
                    const file = await this.bot.getFile(fileId);
                    logger.debug(`File info received:`, file);
                    
                    // Check if we have a valid file path
                    if (!file || !file.file_path) {
                        throw new Error('File path not available');
                    }
                    
                    const fileUrl = `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`;
                    logger.debug(`File URL constructed: ${fileUrl}`);
                    
                    logger.info(`Testing broadcast with image locally for admin ${username} (${userId})`);

                    // Send the message with image back to the sender
                    logger.debug('Sending photo back to admin...');
                    await this.bot.sendPhoto(chatId, fileUrl, {
                        caption: messageText,
                        parse_mode: 'HTML',
                    });
                    
                    // Send a confirmation message
                    await this.bot.sendMessage(
                        chatId,
                        "✅ Broadcast message with image previewed successfully.\n\n" +
                        "This is how your message will appear to users when sent via /broadcast.\n" +
                        "If everything looks correct, you can use /broadcast to send to all users."
                    );
                    
                    logger.info(`Successfully sent local broadcast test with image to ${username} (${userId})`);
                } catch (error) {
                    logger.error('Error processing image:', error);
                    await this.bot.sendMessage(
                        chatId,
                        `❌ Error processing image: ${error.message}\n\n` +
                        `Try using /broadcastlocal with text only, or send the image again.`
                    );
                }
            } else {
                // No image, handle as text-only message
                logger.debug('No image detected, handling as text-only message');
                if (!msg.text) {
                    await this.bot.sendMessage(
                        chatId,
                        "No text content found in your message. Please provide a message to preview."
                    );
                    return;
                }
                
                const commandLength = '/broadcastlocal '.length;
                messageText = msg.text.slice(commandLength);
                logger.debug(`Text message content: "${messageText}"`);

                if (!messageText) {
                    await this.bot.sendMessage(
                        chatId,
                        "Usage:\n" +
                        "1. /broadcastlocal <message> - For text broadcasts\n" + 
                        "2. Upload an image with caption starting with /broadcastlocal - For image broadcasts\n\n" +
                        "Note: For image broadcasts, you must upload the image FIRST, then add the caption."
                    );
                    return;
                }

                logger.info(`Testing broadcast locally for admin ${username} (${userId})`);

                try {
                    // Send the message back to the sender with HTML parsing
                    await this.bot.sendMessage(chatId, messageText, {
                        parse_mode: 'HTML',
                        disable_web_page_preview: true
                    });
                    
                    // Send a confirmation message
                    await this.bot.sendMessage(
                        chatId,
                        "✅ Broadcast message previewed successfully.\n\n" +
                        "This is how your message will appear to users when sent via /broadcast.\n" +
                        "If everything looks correct, you can use /broadcast to send to all users."
                    );
                    
                    logger.info(`Successfully sent local broadcast test to ${username} (${userId})`);
                } catch (error) {
                    this._handleError(error, chatId);
                }
            }
        } catch (error) {
            logger.error('Error in broadcast local:', error);
            await this.bot.sendMessage(
                chatId,
                `❌ An error occurred while testing the broadcast message:\n\n${error.message}`
            );
        }
    }

    _handleError(error, chatId) {
        logger.error(`Error sending local broadcast test:`, error);
        
        // Provide helpful error information
        let errorMessage = "❌ Error sending message.";
        
        if (error.message && error.message.includes("can't parse entities")) {
            errorMessage += "\n\nThere seems to be an issue with your HTML formatting. Common problems include:";
            errorMessage += "\n• Unclosed HTML tags";
            errorMessage += "\n• Incorrect tag nesting";
            errorMessage += "\n• Invalid HTML entities";
            errorMessage += "\n\nPlease check your message and try again.";
        } else {
            errorMessage += "\n\nError details: " + error.message;
        }
        
        this.bot.sendMessage(chatId, errorMessage).catch(e => {
            logger.error('Error sending error message:', e);
        });
    }
}

module.exports = BroadcastLocalHandler;