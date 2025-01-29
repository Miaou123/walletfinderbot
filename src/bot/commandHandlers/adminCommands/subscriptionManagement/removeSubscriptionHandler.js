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
            const subscription = await this.accessControl.subscriptionService.getSubscriptionByUsername(normalizedUsername);

            if (!subscription) {
                console.log("❌ Subscription not found in DB.");
                await this.bot.sendMessage(
                    chatId,
                    `❌ No subscription found for @${username}`
                );
                return;
            }
    
            // Supprimer complètement l'entrée
            const result = await this.accessControl.subscriptionService.removeSubscriptionByUsername(normalizedUsername);
    
            if (result.deletedCount > 0) {
                await this.bot.sendMessage(
                    chatId, 
                    `✅ Subscription successfully removed for @${username}\n` +
                    `Last valid until: ${subscription.expiresAt.toLocaleString()}`
                );
            } else {
                await this.bot.sendMessage(
                    chatId,
                    `❌ Failed to remove subscription for @${username}`
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