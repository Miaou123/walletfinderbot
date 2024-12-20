// src/bot/commandHandlers/subHandler.js

const logger = require('../../utils/logger');

class UserSubscriptionHandler {
    constructor(accessControl, bot) {
        this.accessControl = accessControl;
        this.bot = bot;
    }

    /**
     * Handle the mysubscription command
     */
    async handleMySubscription(bot, msg, args, messageThreadId) {
        const chatId = msg.chat.id;
        const username = msg.from.username;

        try {
            // Récupérer l'abonnement actif de l'utilisateur
            const subscription = await this.accessControl.getActiveSubscription(username);

            if (!subscription) {
                await bot.sendMessage(chatId, 
                    "You don't have an active subscription.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }

            // Formater le message de l'abonnement
            const message = 
                `👤 User: @${subscription.username}\n` +
                `📋 Type: ${subscription.type.toUpperCase()}\n` +
                `⏱️ Duration: ${subscription.duration}\n` +
                `📅 Start Date: ${new Date(subscription.startDate).toLocaleString()}\n` +
                `⚠️ Expires: ${new Date(subscription.expiresAt).toLocaleString()}\n` +
                `💳 Payment ID: ${subscription.paymentId || 'N/A'}\n` +
                `💰 Payment Status: ${subscription.paymentStatus}\n\n` +
                `${'─'.repeat(30)}\n\n` +
                `📊 Summary:\n` +
                `Total Active Subscriptions: 1\n` +
                `Basic Subscriptions: ${subscription.type === 'basic' ? 1 : 0}\n` +
                `VIP Subscriptions: ${subscription.type === 'vip' ? 1 : 0}\n`;

            await bot.sendMessage(chatId, message, { parse_mode: 'HTML', message_thread_id: messageThreadId });
        } catch (error) {
            logger.error('Error in mysubscription command:', error);
            await bot.sendMessage(chatId, "An error occurred while fetching your subscription.", { message_thread_id: messageThreadId });
        }
    }
}

module.exports = UserSubscriptionHandler;
