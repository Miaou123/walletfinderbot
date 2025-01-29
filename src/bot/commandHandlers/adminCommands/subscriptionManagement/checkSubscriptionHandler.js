const BaseAdminHandler = require('../baseAdminHandler');
const logger = require('../../../../utils/logger');

class CheckSubscriptionHandler extends BaseAdminHandler {
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
                    "Usage: /checksub <username>"
                );
                return;
            }
    
            const username = args[0].replace(/^@/, '').toLowerCase(); // Normalisation du username
            const subscription = await this.accessControl.subscriptionService.getSubscriptionByUsername(username);
            
            if (!subscription) {
                await this.bot.sendMessage(
                    chatId,
                    `❌ No subscription found for @${username}`
                );
                return;
            }

            // Vérification de la validité de l'abonnement
            const now = new Date();
            const isActive = subscription.expiresAt > now;
            const daysRemaining = Math.ceil((new Date(subscription.expiresAt) - now) / (1000 * 60 * 60 * 24));
    
            let message = `📊 Subscription info for @${username}:\n\n`;
            message += `Status: ${isActive ? '✅ Active' : '❌ Inactive'}\n`;
            message += `Valid until: ${new Date(subscription.expiresAt).toLocaleString()}\n`;
            message += `⚡ Days remaining: ${isActive ? daysRemaining : 'Expired'}\n`;
            message += `🕒 Member since: ${new Date(subscription.startDate).toLocaleString()}\n\n`;
            message += `💳 Payment History:\n`;

            // Trier l'historique des paiements du plus récent au plus ancien
            if (subscription.paymentHistory && subscription.paymentHistory.length > 0) {
                const sortedHistory = [...subscription.paymentHistory].sort(
                    (a, b) => new Date(b.paymentDate) - new Date(a.paymentDate)
                );
        
                for (const payment of sortedHistory) {
                    const date = new Date(payment.paymentDate).toLocaleDateString();
                    message += `• ${date}: ${payment.duration} (ID: ${payment.paymentId}`;

                    if (payment.transactionHash) {
                        const hash = payment.transactionHash;
                        const shortHash = `${hash.slice(0, 3)}...${hash.slice(-3)}`;
                        message += `, <a href="https://solscan.io/tx/${hash}">tx: ${shortHash}</a>`;
                    }

                    message += `)\n`;
                }
            } else {
                message += "No payment history found.";
            }
    
            await this.bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });

        } catch (error) {
            logger.error('Error in checksub command:', error);
            await this.bot.sendMessage(
                chatId,
                "❌ An error occurred while checking the subscription."
            );
        }
    }
}

module.exports = CheckSubscriptionHandler;
