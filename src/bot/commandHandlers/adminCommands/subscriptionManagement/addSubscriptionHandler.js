const BaseAdminHandler = require('../baseAdminHandler');
const logger = require('../../../../utils/logger');
const { SubscriptionService } = require('../../../../database');

class AddSubscriptionHandler extends BaseAdminHandler {
    constructor(accessControl, bot) {
        super(accessControl, bot);
    }

    async handle(msg, args) {
        const chatId = String(msg.chat.id);
        const userId = msg.from.id;

        try {
            logger.info(`Starting handleAddSubscription for admin ID: ${userId}`);

            if (!await this.checkAdmin(userId)) {
                return;
            }

            // Vérifier les arguments
            if (!Array.isArray(args) || args.length < 2) {
                await this.bot.sendMessage(
                    chatId,
                    "Usage: /addsub <username> <duration>\n" +
                    "Example: /addsub username 3month\n" +
                    "Available durations: 1month, 3month, 6month"
                );
                return;
            }

            // Normalisation des arguments
            const [username, duration] = args;
            const normalizedUsername = username.replace(/^@/, '').toLowerCase();
            const normalizedDuration = duration.toLowerCase();

            if (!['1month', '3month', '6month'].includes(normalizedDuration)) {
                await this.bot.sendMessage(
                    chatId,
                    "❌ Invalid duration. Available options:\n" +
                    "• 1month\n" +
                    "• 3month\n" +
                    "• 6month"
                );
                return;
            }

            // Générer un paiement fictif pour l'ajout manuel
            const paymentId = `admin_payment_${Date.now()}`;
            const amount = this.accessControl.subscriptionService.SUBSCRIPTION_TYPES[normalizedDuration.toUpperCase()]?.price || 0;

            // Création ou mise à jour de l'abonnement
            await this.accessControl.subscriptionService.createOrUpdateSubscription(
                `admin_${Date.now()}`, // On met un chatId factice si non disponible
                normalizedUsername,
                paymentId,
                amount,
                {}
            );

            // Récupération de l'abonnement mis à jour
            const subscription = await this.accessControl.subscriptionService.getSubscriptionByUsername(normalizedUsername);

            // Vérification pour éviter une erreur si l'abonnement n'est pas trouvé
            if (!subscription) {
                await this.bot.sendMessage(
                    chatId,
                    `⚠️ Subscription could not be found for @${normalizedUsername} after creation.`
                );
                return;
            }

            await this.bot.sendMessage(
                chatId,
                `✅ Subscription created/updated\n\n` +
                `👤 User: @${normalizedUsername}\n` +
                `⏰ Duration: ${normalizedDuration}\n` +
                `📅 Expires: ${new Date(subscription.expiresAt).toLocaleDateString()}\n` +
                `🆔 Payment ID: ${paymentId}`
            );

        } catch (error) {
            logger.error('Error in addsub command:', error);
            await this.bot.sendMessage(
                chatId,
                "❌ An error occurred while creating the subscription.\n" +
                "Please try again or contact support."
            );
        }
    }
}

module.exports = AddSubscriptionHandler;
