const logger = require('../../utils/logger');

class UserSubscriptionHandler {
    constructor(accessControl) {
        this.accessControl = accessControl;
    }

    async handleMySubscription(bot, msg, args, messageThreadId) {
        const chatId = msg.chat.id;
        const username = msg.from.username;

        try {
            const profile = await this.accessControl.getSubscription(username);

            if (!profile || !profile.active) {
                const message = "You don't have an active subscription. Would you like to subscribe?";
                const opts = {
                    reply_markup: JSON.stringify({
                        inline_keyboard: [
                            [{ text: "🌟 Subscribe Now", callback_data: 'subscribe_new' }]
                        ]
                    }),
                    message_thread_id: messageThreadId
                };

                await bot.sendMessage(chatId, message, opts);
                return;
            }

            // Calculer les jours restants
            const daysLeft = Math.ceil((new Date(profile.expiresAt) - new Date()) / (1000 * 60 * 60 * 24));

            // Formatage du message principal
            let message = 
                `📊 Subscription Status\n\n` +
                `👤 Username: @${profile.username}\n` +
                `📅 Valid until: ${new Date(profile.expiresAt).toLocaleString()}\n` +
                `⚡ Days remaining: ${daysLeft}\n` +
                `🕒 Member since: ${new Date(profile.startDate).toLocaleString()}\n\n` +
                `💳 Payment History:\n`;

            // Ajouter l'historique des paiements (3 derniers)
            const recentPayments = profile.paymentHistory
                .slice(-3)
                .reverse()
                .map(payment => 
                    `• ${new Date(payment.paymentDate).toLocaleDateString()}: ` +
                    `${payment.duration} (ID: ${payment.paymentId})`
                )
                .join('\n');

            message += recentPayments + '\n';
            message += `\n${'─'.repeat(30)}\n`;

            const opts = {
                parse_mode: 'HTML',
                message_thread_id: messageThreadId
            };

            // Ajouter le bouton de renouvellement si proche de l'expiration
            if (daysLeft <= 7) {
                opts.reply_markup = JSON.stringify({
                    inline_keyboard: [
                        [{ text: "🔄 Extend Subscription", callback_data: 'subscribe_extend' }]
                    ]
                });
            }

            await bot.sendMessage(chatId, message, opts);
        } catch (error) {
            logger.error('Error in mysubscription command:', error);
            await bot.sendMessage(chatId, 
                "An error occurred while retrieving your subscription information.", 
                { message_thread_id: messageThreadId }
            );
        }
    }
}

module.exports = UserSubscriptionHandler;