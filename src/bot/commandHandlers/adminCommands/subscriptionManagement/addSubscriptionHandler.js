const BaseAdminHandler = require('../baseAdminHandler');
const logger = require('../../../../utils/logger');
const { SubscriptionService } = require('../../../../database');
const UserService = require('../../../../database/services/userService');

class AddSubscriptionHandler extends BaseAdminHandler {
    constructor(accessControl, bot) {
        super(accessControl, bot);
    }

    async handle(msg, args) {
        const chatId = String(msg.chat.id);
        const adminUserId = msg.from.id;

        // Declare fallback-safe variables
        let normalizedUsername = 'unknown';
        let normalizedDuration = 'unknown';

        try {
            logger.info(`Starting handleAddSubscription for admin ID: ${adminUserId}`);

            if (!await this.checkAdmin(adminUserId)) {
                return;
            }

            // Vérifier les arguments
            if (!Array.isArray(args) || args.length < 2) {
                await this.bot.sendMessage(
                    chatId,
                    "Usage: /addsub <username> <duration>\n" +
                    "Example: /addsub username 30\n" +
                    "The duration is in days (e.g., 30 for one month)"
                );
                return;
            }

            // Normalisation des arguments
            const [username, duration] = args;
            normalizedUsername = username.replace(/^@/, '').toLowerCase();
            normalizedDuration = duration.toLowerCase();

            const daysToAdd = parseInt(normalizedDuration, 10);
            if (isNaN(daysToAdd) || daysToAdd <= 0) {
                await this.bot.sendMessage(
                    chatId,
                    "❌ Invalid duration. Please provide a number of days greater than 0.\n" +
                    "Example: /addsub username 30"
                );
                return;
            }

            // Verify if the user exists in our database and get their actual userId
            const user = await UserService.getUser(normalizedUsername);
            
            // Générer un paiement fictif pour l'ajout manuel
            const paymentId = `admin_payment_${Date.now()}`;
            const amount = SubscriptionService.SUBSCRIPTION_TYPES.USER.price;
            
            // Get database connection
            const database = await require('../../../../database/config/connection').getDatabase();
            const collection = database.collection("subscriptions");
            
            // Calculate expiry date based on duration
            const now = new Date();
            let expiryDate = new Date(now);
            expiryDate.setDate(expiryDate.getDate() + daysToAdd);
            
            
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
                    paymentId,  // This will start with admin_payment_
                    duration: `${daysToAdd} days`,
                    amount,
                    paymentDate: now,
                    paymentStatus: 'completed',
                    transactionHash: '',
                    transferHash: '',
                    adminGranted: true,  // Mark this explicitly as admin-granted
                    grantedBy: `admin_${adminUserId}`
                };
                
                // If the existing subscription hasn't expired, extend from that date
                if (existingSubscription.expiresAt && new Date(existingSubscription.expiresAt) > now) {
                    expiryDate = new Date(existingSubscription.expiresAt);
                    expiryDate.setDate(expiryDate.getDate() + daysToAdd);
                }
                
                await collection.updateOne(
                    { username: normalizedUsername },
                    {
                        $set: {
                            expiresAt: expiryDate,
                            active: true,
                            lastUpdated: now,
                            adminGranted: true  // Add flag at the subscription level too
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
                
                // Use the user's actual userId and chatId if available
                // Otherwise generate temporary IDs
                const userId = user ? user.userId : `admin_generated_${Date.now()}`;
                const realChatId = user ? user.chatId : `admin_added_${normalizedUsername}`;
                
                const newSubscription = {
                    userId,
                    chatId: realChatId,
                    username: normalizedUsername,
                    active: true,
                    startDate: now,
                    expiresAt: expiryDate,
                    lastUpdated: now,
                    adminGranted: true,  // Flag subscription as admin-granted
                    paymentHistory: [{
                        userId,
                        paymentId,  // This will start with admin_payment_
                        duration: `${daysToAdd} days`,
                        amount,
                        paymentDate: now,
                        paymentStatus: 'completed',
                        transactionHash: '',
                        transferHash: '',
                        adminGranted: true,  // Mark this payment explicitly as admin-granted
                        grantedBy: `admin_${adminUserId}`
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

            const userStatus = user ? "Found in database" : "Not found in database";
            
            await this.bot.sendMessage(
                chatId,
                `✅ Subscription created/updated\n\n` +
                `👤 User: @${normalizedUsername} (${userStatus})\n` +
                `⏰ Duration: ${daysToAdd} day(s)\n` +
                `📅 Expires: ${new Date(finalSubscription.expiresAt).toLocaleDateString()}\n` +
                `🆔 UserID: ${finalSubscription.userId}\n` +
                `🆔 Payment ID: ${paymentId}\n` +
                `🔑 Admin granted: Yes`
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