// src/bot/commandHandlers/adminCommands/subscriptionManagement/listSubscriptionsHandler.js

const BaseAdminHandler = require('../baseAdminHandler');
const logger = require('../../../../utils/logger');

class ListSubscriptionsHandler extends BaseAdminHandler {
    constructor(accessControl, bot) {
        super(accessControl, bot);
    }

    async handle(msg) {
        
        const chatId = String(msg.chat.id);
        const userId = msg.from.id;
    
        try {
            if (!await this.checkAdmin(userId)) {
                return;
            }
    
            const now = new Date();
            const subscriptions = await this.accessControl.subscriptionService.getSubscriptionList();

            console.log("Subscriptions found:", subscriptions);
    
            // Filtrer pour ne garder que les abonnements actifs
            const activeSubscriptions = subscriptions.filter(
                sub => new Date(sub.expiresAt) > now
            );
    
            if (activeSubscriptions.length === 0) {
                await this.bot.sendMessage(
                    chatId,
                    "📝 No active subscriptions found."
                );
                return;
            }
    
            let message = "📊 Active Subscriptions:\n\n";
            
            for (const sub of activeSubscriptions) {
                const daysLeft = Math.ceil(
                    (new Date(sub.expiresAt) - now) / (1000 * 60 * 60 * 24)
                );
                message += `✅ @${sub.username}\n`;
                message += `⏳ Days remaining: ${daysLeft}\n`;
                message += `📅 Expires: ${new Date(sub.expiresAt).toLocaleDateString()}\n\n`;
            }
    
            message += `\n📈 Total active subscriptions: ${activeSubscriptions.length}`;
    
            await this.bot.sendMessage(chatId, message);
    
        } catch (error) {
            logger.error('Error in listsubs command:', error);
            await this.bot.sendMessage(
                chatId,
                "❌ An error occurred while listing subscriptions."
            );
        }
    }
}

module.exports = ListSubscriptionsHandler;