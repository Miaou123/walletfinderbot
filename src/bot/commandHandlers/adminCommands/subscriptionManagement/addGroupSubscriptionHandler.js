const BaseAdminHandler = require('../baseAdminHandler');
const logger = require('../../../../utils/logger');
const { SubscriptionService, getDatabase } = require('../../../../database');

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
            
            // Calculate expiry date based on duration
            const now = new Date();
            let expiryDate = new Date(now);
            
            if (duration === '1month') {
                expiryDate.setMonth(expiryDate.getMonth() + 1);
            } else if (duration === '3month') {
                expiryDate.setMonth(expiryDate.getMonth() + 3);
            } else if (duration === '6month') {
                expiryDate.setMonth(expiryDate.getMonth() + 6);
            }
            
            // Set up transaction data
            const transactionData = {
                adminGranted: true,
                amount: 0
            };

            // Création ou mise à jour de l'abonnement du groupe via direct database operations
            const database = await getDatabase();
            const collection = database.collection("group_subscriptions");
            
            logger.info(`Processing group subscription for group "${msg.chat.title}" (${chatId})`);
            
            // Check if a subscription already exists
            const existingSubscription = await collection.findOne({ chatId });
            
            // Create payment entry
            const paymentEntry = {
                paymentId,
                paymentDate: now,
                paidByUserId: String(userId),
                paidByUsername: msg.from.username || 'unknown',
                duration: `Admin grant: ${duration}`,
                amount: 0,
                ...transactionData
            };
            
            // If existing subscription hasn't expired yet, extend from that date
            if (existingSubscription && 
                existingSubscription.expiresAt && 
                new Date(existingSubscription.expiresAt) > now) {
                logger.info(`Extending existing group subscription for ${msg.chat.title}`);
                expiryDate = new Date(existingSubscription.expiresAt);
                expiryDate.setMonth(expiryDate.getMonth() + 
                    (duration === '1month' ? 1 : (duration === '3month' ? 3 : 6)));
            }
            
            // Create a document that matches schema requirements
            const document = {
                chatId,
                groupName: msg.chat.title,
                adminUserId: String(userId),  // Required by schema
                expiresAt: expiryDate,
                lastUpdated: now,
                active: true,
                startDate: existingSubscription ? existingSubscription.startDate : now
            };
            
            // Update or create subscription
            const result = await collection.findOneAndUpdate(
                { chatId },
                {
                    $set: document,
                    $push: { paymentHistory: paymentEntry }
                },
                { 
                    upsert: true, 
                    returnDocument: 'after' 
                }
            );
            
            logger.info(`Group subscription successfully processed for ${msg.chat.title}`);
            const groupSubscription = result.value;
            
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
            logger.error('Error in addgroupsub command:', {
                errorMessage: error.message,
                errorStack: error.stack,
                groupName: msg.chat.title,
                chatId: chatId,
                duration: duration
            });
            await this.bot.sendMessage(
                chatId,
                "❌ An error occurred while creating the group subscription.\n" +
                "Error details: " + error.message + "\n" +
                "Please try again or contact support."
            );
        }
    }
}

module.exports = AddGroupSubscriptionHandler;
