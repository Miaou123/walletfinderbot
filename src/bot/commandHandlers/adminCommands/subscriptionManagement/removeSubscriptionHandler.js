// src/bot/commandHandlers/adminCommands/subscriptionManagement/removeSubscriptionHandler.js

const BaseAdminHandler = require('../baseAdminHandler');
const logger = require('../../../../utils/logger');

class RemoveSubscriptionHandler extends BaseAdminHandler {
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
    
            if (args.length < 1) {
                await this.bot.sendMessage(
                    chatId,
                    "Usage: /removesub <username>"
                );
                return;
            }
    
            const username = args[0];
            const normalizedUsername = this.accessControl.normalizeUsername(username);
            
            // Obtenir la subscription avant de la supprimer pour avoir les infos d'expiration
            const subscription = await this.accessControl.subscriptionService.getSubscriptionByChatId(chatId);
            
            // Supprimer la subscription
            const result = await this.accessControl.subscriptionService.removeSubscriptionByUsername(normalizedUsername);
    
            if (result.success) {
                const expiryInfo = subscription 
                    ? `\nLast valid until: ${subscription.expiresAt.toLocaleString()}`
                    : '';
                
                await this.bot.sendMessage(
                    chatId, 
                    `✅ Subscription successfully removed for @${username}${expiryInfo}`
                );
            } else {
                await this.bot.sendMessage(
                    chatId,
                    `❌ ${result.message} for @${username}`
                );
            }
        } catch (error) {
            logger.error('Error in removesub command:', error);
            await this.bot.sendMessage(
                chatId,
                "❌ An error occurred while removing the subscription."
            );
        }
    }
}

module.exports = RemoveSubscriptionHandler;