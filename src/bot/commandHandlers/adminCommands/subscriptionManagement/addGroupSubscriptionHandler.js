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
        let normalizedDuration;

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
            normalizedDuration = args[0].toLowerCase();

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

            // Use the SubscriptionService directly
            try {
                const database = await getDatabase();
                const collection = database.collection("group_subscriptions");
                
                // Generate payment ID
                const paymentId = `admin_payment_${Date.now()}`;
                const amount = SubscriptionService.SUBSCRIPTION_TYPES.GROUP.price;
                
                // Calculate expiry date
                const now = new Date();
                let expiryDate = new Date(now);
                const monthsToAdd = normalizedDuration === '1month' ? 1 : 
                                  (normalizedDuration === '3month' ? 3 : 6);
                expiryDate.setMonth(expiryDate.getMonth() + monthsToAdd);
                
                // Create payment record
                const paymentRecord = {
                    paidByUserId: String(userId),
                    paidByUsername: msg.from.username || 'unknown',
                    paymentId,
                    duration: normalizedDuration,
                    paymentDate: now,
                    paymentStatus: 'completed',
                    amount,
                    transactionHash: '',
                    transferHash: '',
                    adminGranted: true
                };
                
                // Check if subscription exists
                const existingSubscription = await collection.findOne({ chatId });
                
                if (existingSubscription) {
                    // If existing subscription is still active, extend from that date
                    if (existingSubscription.expiresAt && new Date(existingSubscription.expiresAt) > now) {
                        expiryDate = new Date(existingSubscription.expiresAt);
                        expiryDate.setMonth(expiryDate.getMonth() + monthsToAdd);
                    }
                    
                    // Update subscription
                    await collection.updateOne(
                        { chatId },
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
                    
                    logger.info(`Updated group subscription for group ${msg.chat.title} (${chatId})`);
                } else {
                    // Create new subscription
                    const newSubscription = {
                        chatId,
                        groupName: msg.chat.title,
                        adminUserId: String(userId),
                        active: true,
                        startDate: now,
                        expiresAt: expiryDate,
                        lastUpdated: now,
                        paymentHistory: [paymentRecord]
                    };
                    
                    await collection.insertOne(newSubscription);
                    logger.info(`Created new group subscription for group ${msg.chat.title} (${chatId})`);
                }
                
                // Success message - don't rely on database lookup for confirmation
                await this.bot.sendMessage(
                    chatId,
                    `✅ Group Subscription created/updated\n\n` +
                    `🏛 Group: ${msg.chat.title}\n` +
                    `⏰ Duration: ${normalizedDuration}\n` +
                    `📅 Expires: ${expiryDate.toLocaleDateString()}\n` +
                    `🆔 Payment ID: ${paymentId}`
                );
                
            } catch (dbError) {
                logger.error('Database error in addgroupsub command:', {
                    errorMessage: dbError.message,
                    errorStack: dbError.stack,
                    groupName: msg.chat.title,
                    chatId: chatId
                });
                
                await this.bot.sendMessage(
                    chatId,
                    "❌ Database error while processing group subscription.\n" +
                    "Error: " + dbError.message
                );
            }

        } catch (error) {
            logger.error('Error in addgroupsub command:', {
                errorMessage: error.message,
                errorStack: error.stack,
                groupName: msg.chat.title,
                chatId: chatId,
                duration: normalizedDuration
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
