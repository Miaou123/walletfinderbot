const BaseAdminHandler = require('../baseAdminHandler');
const logger = require('../../../../utils/logger');

class AddGroupSubscriptionHandler extends BaseAdminHandler {
    constructor(accessControl, bot) {
        super(accessControl, bot);
    }

    async handle(msg, args) {
        const chatId = String(msg.chat.id);
        const userId = msg.from.id;
        const isGroup = msg.chat.type === 'supergroup' || msg.chat.type === 'group';

        try {
            logger.info(`Starting handleAddGroupSubscription for admin ID: ${userId} in chat: ${chatId}`);

            if (!await this.checkAdmin(userId)) {
                return;
            }

            // Vérifier que la commande est bien exécutée dans un groupe
            if (!isGroup) {
                await this.bot.sendMessage(
                    chatId,
                    "❌ This command must be used inside a group chat."
                );
                return;
            }

            // Vérifier les arguments
            if (!Array.isArray(args) || args.length < 1) {
                await this.bot.sendMessage(
                    chatId,
                    "Usage: /addgroupsub <duration>\n" +
                    "Example: /addgroupsub 3month\n" +
                    "Available durations: 1month, 3month, 6month"
                );
                return;
            }

            // Normalisation des arguments
            const duration = args[0].toLowerCase();

            if (!['1month', '3month', '6month'].includes(duration)) {
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
            const amount = this.accessControl.subscriptionService.SUBSCRIPTION_TYPES[duration.toUpperCase()]?.price || 0;

            // Création ou mise à jour de l'abonnement du groupe
            await this.accessControl.subscriptionService.createOrUpdateGroupSubscription(
                chatId, // ID du groupe récupéré directement
                msg.chat.title, // Nom du groupe
                { id: String(userId), username: msg.from.username }, // Admin qui ajoute l'abonnement
                paymentId,
                {}
            );

            // Récupération de l'abonnement du groupe mis à jour
            const groupSubscription = await this.accessControl.subscriptionService.getGroupSubscription(chatId);

            // Vérification pour éviter une erreur si l'abonnement n'est pas trouvé
            if (!groupSubscription) {
                await this.bot.sendMessage(
                    chatId,
                    `⚠️ Group subscription could not be found for ${msg.chat.title} after creation.`
                );
                return;
            }

            await this.bot.sendMessage(
                chatId,
                `✅ Group Subscription created/updated\n\n` +
                `🏛 Group: ${msg.chat.title}\n` +
                `⏰ Duration: ${duration}\n` +
                `📅 Expires: ${new Date(groupSubscription.expiresAt).toLocaleDateString()}\n` +
                `🆔 Payment ID: ${paymentId}`
            );

        } catch (error) {
            logger.error('Error in addgroupsub command:', error);
            await this.bot.sendMessage(
                chatId,
                "❌ An error occurred while creating the group subscription.\n" +
                "Please try again or contact support."
            );
        }
    }
}

module.exports = AddGroupSubscriptionHandler;
