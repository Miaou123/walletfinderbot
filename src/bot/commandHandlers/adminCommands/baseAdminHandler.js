// src/bot/commandHandlers/adminCommands/baseAdminHandler.js

const logger = require('../../../utils/logger');

class BaseAdminHandler {
    constructor(accessControl, bot) {
        if (!accessControl || !bot) {
            throw new Error('AccessControl and bot instances are required');
        }
        this.accessControl = accessControl;
        this.bot = bot;
    }

    async validateMessage(msg) {
        if (!msg) {
            throw new Error('Message object is required');
        }
        if (!msg.chat?.id) {
            throw new Error('Message chat id is required');
        }
        if (!msg.from?.id) {
            throw new Error('Message sender id is required');
        }
        return {
            chatId: String(msg.chat.id),
            userId: Number(msg.from.id),
            username: msg.from.username
        };
    }

    async checkAdmin(userId) {
        try {
            logger.debug(`Checking admin status for user ${userId}`);
            if (!await this.accessControl.isAdmin(userId)) {
                return false;
            }
            return true;
        } catch (error) {
            logger.error('Error checking admin status:', error);
            return false;
        }
    }
    

    async handleError(error, chatId, customMessage = null) {
        logger.error('Handler error:', error);
        try {
            await this.bot.sendMessage(
                chatId,
                customMessage || "❌ An error occurred while processing your command."
            );
        } catch (sendError) {
            logger.error('Error sending error message:', sendError);
        }
    }
}

module.exports = BaseAdminHandler;