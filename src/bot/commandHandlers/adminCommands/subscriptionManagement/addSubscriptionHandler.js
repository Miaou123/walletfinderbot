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
            const amount = SubscriptionService.SUBSCRIPTION_TYPES.USER.price;
            
            // Instead of using the service, we'll create the subscription document directly
            // to ensure it matches the required schema
            const database = await require('../../../../database/config/connection').getDatabase();
            const collection = database.collection("subscriptions");
            
            // Calculate expiry date based on duration
            const now = new Date();
            let expiryDate = new Date(now);
            const monthsToAdd = normalizedDuration === '1month' ? 1 : 
                               (normalizedDuration === '3month' ? 3 : 6);
            expiryDate.setMonth(expiryDate.getMonth() + monthsToAdd);
            
            // Check if a subscription already exists
            const existingSubscription = await collection.findOne({ 
                username: normalizedUsername 
            });
            
            let finalSubscription;
            
            if (existingSubscription) {
                // Update existing subscription
                logger.info(`Updating existing subscription for user @${normalizedUsername}`);
                
                const paymentRecord = {
                    userId: existingSubscription.userId,
                    paymentId,
                    duration: normalizedDuration,
                    amount,
                    paymentDate: now,
                    paymentStatus: 'completed',
                    transactionHash: '',
                    transferHash: '',
                    adminGranted: true
                };
                
                // If the existing subscription hasn't expired, extend from that date
                if (existingSubscription.expiresAt && new Date(existingSubscription.expiresAt) > now) {
                    expiryDate = new Date(existingSubscription.expiresAt);
                    expiryDate.setMonth(expiryDate.getMonth() + monthsToAdd);
                }
                
                await collection.updateOne(
                    { username: normalizedUsername },
                    {
                        $set: {
                            expiresAt: expiryDate,
                            active: true,
                            lastUpdated: now
                        },
                        $push: {
                            paymentHistory: paymentRecord
                        }
                    }
                );
                
                finalSubscription = await collection.findOne({ username: normalizedUsername });
            } else {
                // Create new subscription
                logger.info(`Creating new subscription for user @${normalizedUsername}`);
                
                // Generate a unique userId
                const userId = `user_${Date.now()}`;
                
                const newSubscription = {
                    userId: userId,
                    chatId: chatId,
                    username: normalizedUsername,
                    active: true,
                    startDate: now,
                    expiresAt: expiryDate,
                    lastUpdated: now,
                    paymentHistory: [{
                        userId: userId,
                        paymentId,
                        duration: normalizedDuration,
                        amount,
                        paymentDate: now,
                        paymentStatus: 'completed',
                        transactionHash: '',
                        transferHash: '',
                        adminGranted: true
                    }]
                };
                
                await collection.insertOne(newSubscription);
                finalSubscription = await collection.findOne({ username: normalizedUsername });
            }
            
            // Vérification pour éviter une erreur si l'abonnement n'est pas trouvé
            if (!finalSubscription) {
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
                `📅 Expires: ${new Date(finalSubscription.expiresAt).toLocaleDateString()}\n` +
                `🆔 Payment ID: ${paymentId}`
            );

        } catch (error) {
            logger.error('Error in addsub command:', {
                errorMessage: error.message,
                errorStack: error.stack,
                username: normalizedUsername,
                duration: normalizedDuration
            });
            await this.bot.sendMessage(
                chatId,
                "❌ An error occurred while creating the subscription.\n" +
                "Error details: " + error.message + "\n" +
                "Please try again or contact support."
            );
        }
    }
}

module.exports = AddSubscriptionHandler;
