const logger = require('../../utils/logger');
const { subscriptionDurations } = require('../../database/models/subscription');

class AdminCommandHandler {
    constructor(userManager, accessControl, bot) {
        this.userManager = userManager;
        this.accessControl = accessControl;
        this.bot = bot;
    }

    /**
     * Handle the adduser command
     */
    async handleAddUser(bot, msg, args) {
        const chatId = msg.chat.id;
        const adminUsername = msg.from.username;
    
        try {
            if (!await this.accessControl.isAdmin(adminUsername)) {
                await bot.sendMessage(chatId, "You are not authorized to use this command.");
                return;
            }
    
            if (args.length < 2) {
                // Échapper les chevrons
                await bot.sendMessage(
                    chatId,
                    "Usage: /adduser &lt;username&gt; &lt;type&gt;\nTypes: normal, vip, admin"
                );
                return;
            }
    
            const [newUser, userType] = args;
            const roleMap = { normal: 'user', vip: 'vip', admin: 'admin' };
            const role = roleMap[userType.toLowerCase()];
    
            // Ajout du chatId (null car on ne le connait pas encore)
            await this.accessControl.addUser(newUser, role, null);
            await bot.sendMessage(chatId, `User ${newUser} has been added as ${role}.`);
        } catch (error) {
            logger.error('Error in adduser command:', error);
            await bot.sendMessage(chatId, "An error occurred while adding the user.");
        }
    }

    /**
     * Handle the removeuser command
     */
    async handleRemoveUser(bot, msg, args) {
        const chatId = msg.chat.id;
        const adminUsername = msg.from.username;

        try {
            if (!this.accessControl.isAdmin(adminUsername)) {
                await bot.sendLongMessage(chatId, "You are not authorized to use this command.");
                return;
            }

            if (args.length < 1) {
                // Échapper les chevrons
                await bot.sendLongMessage(chatId, "Usage: /removeuser &lt;username&gt;");
                return;
            }

            const userToRemove = args[0];
            await this.accessControl.removeUser(userToRemove);
            await bot.sendLongMessage(chatId, `User ${userToRemove} has been removed.`);
        } catch (error) {
            logger.error('Error in removeuser command:', error);
            await bot.sendMessage(msg.chat.id, "An error occurred while removing the user.");
        }
    }

    /**
     * Handle the addgroup command
     */
    async handleAddGroup(bot, msg, args) {
        const chatId = msg.chat.id;
        const adminUsername = msg.from.username;
        
        try {
            if (!this.accessControl.isAdmin(adminUsername)) {
                await bot.sendLongMessage(chatId, "You are not authorized to use this command.");
                return;
            }

            // Vérifier si nous sommes dans un groupe
            const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
            let targetGroupId;
            let groupType;

            // Obtenir le bot ID
            const botInfo = await bot.getMe();
            const botId = botInfo.id;

            if (isGroup) {
                // Dans un groupe
                targetGroupId = msg.chat.id;
                groupType = args.length > 0 ? args[0].toLowerCase() : 'normal';

                if (groupType && !['normal', 'vip'].includes(groupType)) {
                    await bot.sendLongMessage(chatId, "Invalid group type. Use 'normal' or 'vip'.");
                    return;
                }
            } else {
                // En privé, on a besoin de l'ID du groupe et du type
                if (args.length < 2) {
                    const helpMessage = 
                        "Usage in private chat:\n" +
                        "<code>/addgroup &lt;group_id&gt; &lt;type&gt;</code>\n\n" +
                        "Types: normal, vip\n\n" +
                        "Example:\n" +
                        "<code>/addgroup -1001234567890 normal</code>\n\n" +
                        "Note: To add a group directly, execute the command in the target group.";
                    
                    await bot.sendLongMessage(chatId, helpMessage, { parse_mode: 'HTML' });
                    return;
                }

                targetGroupId = args[0];
                groupType = args[1].toLowerCase();

                if (!['normal', 'vip'].includes(groupType)) {
                    await bot.sendLongMessage(chatId, "Invalid group type. Use 'normal' or 'vip'.");
                    return;
                }
            }

            // Vérifier l'accès au groupe
            try {
                const chat = await bot.getChat(targetGroupId);
                const chatMember = await bot.getChatMember(targetGroupId, botId.toString());
                
                if (!['administrator', 'member'].includes(chatMember.status)) {
                    await bot.sendLongMessage(
                        chatId, 
                        "The bot is not a member of this group. " +
                        "Please add the bot to the group first."
                    );
                    return;
                }

                // Ajouter le groupe
                await this.accessControl.addGroup(targetGroupId, groupType);
                
                // Message de confirmation avec le titre du groupe
                const successMessage = `Group "${chat.title}" has been added as ${groupType}.\nGroup ID: ${targetGroupId}`;
                await bot.sendLongMessage(chatId, successMessage);

                // Si on n'est pas dans le groupe cible, envoyer une confirmation là-bas aussi
                if (chatId !== targetGroupId) {
                    try {
                        await bot.sendMessage(
                            targetGroupId,
                            "This group has been whitelisted. " +
                            "All members can now use the bot's commands in this group chat."
                        );
                    } catch (error) {
                        logger.error('Error sending group confirmation:', error);
                        await bot.sendLongMessage(
                            chatId, 
                            "Group was whitelisted but I couldn't send a confirmation message. " +
                            "Make sure the bot has permission to send messages in the group."
                        );
                    }
                }
            } catch (error) {
                logger.error('Error accessing group:', error);
                if (error.code === 'ETELEGRAM') {
                    // Log plus détaillé pour les erreurs Telegram
                    logger.error('Telegram error details:', {
                        errorCode: error.response?.body?.error_code,
                        description: error.response?.body?.description
                    });
                }
                await bot.sendLongMessage(
                    chatId, 
                    "Could not access the group. Please make sure:\n" +
                    "1. The bot is added to the group\n" +
                    "2. The bot has necessary permissions (can read messages and send messages)\n" +
                    "3. You are using the command in the target group"
                );
            }
        } catch (error) {
            logger.error('Error in addgroup command:', error);
            await bot.sendMessage(chatId, "An error occurred while adding the group.");
        }
    }

    /**
     * Handle the removegroup command
     */
    async handleRemoveGroup(bot, msg, args) {
        const chatId = msg.chat.id;
        const adminUsername = msg.from.username;
        
        try {
            if (!this.accessControl.isAdmin(adminUsername)) {
                await bot.sendLongMessage(chatId, "You are not authorized to use this command.");
                return;
            }

            if (args.length < 1) {
                // Échapper
                await bot.sendLongMessage(chatId, "Usage: /removegroup &lt;group_id&gt;");
                return;
            }

            const groupId = args[0];
            
            if (!/^-?\d+$/.test(groupId)) {
                await bot.sendLongMessage(chatId, "Invalid group ID format. Please provide a valid Telegram group ID.");
                return;
            }

            await this.accessControl.removeGroup(groupId);
            await bot.sendLongMessage(chatId, `Group ${groupId} has been removed from whitelist.`);
            
            try {
                await bot.sendMessage(
                    groupId, 
                    "This group has been removed from the whitelist. Commands will no longer be available in this group chat."
                );
            } catch (error) {
                await bot.sendLongMessage(chatId, "Group was removed but I couldn't send a notification message.");
            }
        } catch (error) {
            logger.error('Error in removegroup command:', error);
            await bot.sendMessage(chatId, "An error occurred while removing the group.");
        }
    }

    /**
     * Handle the addsub command (Add Subscription)
     */
    async handleAddSubscription(bot, msg, args) {
        const chatId = msg.chat.id;
        const adminUsername = msg.from.username;
    
        try {
            logger.info(`Starting handleAddSubscription for admin: ${adminUsername}`);
    
            if (!await this.accessControl.isAdmin(adminUsername)) {
                logger.info(`User ${adminUsername} is not admin, rejecting command`);
                await bot.sendMessage(chatId, "You are not authorized to use this command.");
                return;
            }
    
            // Simplification du traitement des arguments
            const processedArgs = Array.isArray(args) ? args : args.split(',').map(arg => arg.trim());
            logger.info(`Processed args: ${JSON.stringify(processedArgs)}`);
    
            if (processedArgs.length < 2) {
                // Échapper
                await bot.sendMessage(
                    chatId, 
                    "Usage: /addsub &lt;username&gt; &lt;duration&gt;\n" +
                    "Example: /addsub username 3month\n" +
                    "Available durations: 1month, 3month, 6month"
                );
                return;
            }
    
            // Extraire et valider les arguments
            const [username, duration] = processedArgs;
            const normalizedUsername = username.replace(/^@/, '').toLowerCase();
            const normalizedDuration = duration.toLowerCase();
            
            if (!['1month', '3month', '6month'].includes(normalizedDuration)) {
                await bot.sendMessage(
                    chatId,
                    "Invalid duration. Available options:\n" +
                    "• 1month\n" +
                    "• 3month\n" +
                    "• 6month"
                );
                return;
            }
    
            // Créer l'abonnement
            const paymentId = `test_payment_${Date.now()}`;
            await this.accessControl.createSubscription(normalizedUsername, normalizedDuration);
            await this.accessControl.updateSubscriptionPayment(normalizedUsername, paymentId, 'completed');
    
            const subscription = await this.accessControl.getSubscription(normalizedUsername);
            
            await bot.sendMessage(
                chatId, 
                `✅ Subscription created\n\n` +
                `User: ${normalizedUsername}\n` +
                `Duration: ${normalizedDuration}\n` +
                `Expires: ${subscription.expiresAt.toLocaleDateString()}\n` +
                `Payment ID: ${paymentId}`
            );
                
        } catch (error) {
            logger.error('Error in addsub command:', error);
            await bot.sendMessage(
                chatId, 
                "❌ An error occurred while creating the subscription.\n" +
                "Please try again or contact support."
            );
        }
    }

    /**
     * Handle the checksub command
     */
    async handleCheckSubscription(bot, msg, args) {
        const chatId = msg.chat.id;
        const adminUsername = msg.from.username;
    
        try {
            if (!await this.accessControl.isAdmin(adminUsername)) {
                await bot.sendMessage(chatId, "You are not authorized to use this command.");
                return;
            }
    
            if (args.length < 1) {
                await bot.sendMessage(chatId, "Usage: /checksub <username>");
                return;
            }
    
            const username = args[0];
            const subscription = await this.accessControl.getSubscription(username);
            
            if (!subscription) {
                await bot.sendMessage(chatId, `No subscription found for @${username}`);
                return;
            }
    
            const daysRemaining = Math.ceil((subscription.expiresAt - new Date()) / (1000 * 60 * 60 * 24));
            
            let message = "📊 Subscription info for @${username}:\n\n";
            message += `Status: ${subscription.active ? '✅ Active' : '❌ Inactive'}\n`;
            message += `Valid until: ${subscription.expiresAt.toLocaleString()}\n`;
            message += `⚡ Days remaining: ${daysRemaining}\n`;
            message += `🕒 Member since: ${new Date(subscription.startDate).toLocaleString()}\n\n`;
            message += `💳 Payment History:\n`;
    
            // Trier l'historique par date décroissante
            const sortedHistory = [...subscription.paymentHistory].sort((a, b) => 
                new Date(b.paymentDate) - new Date(a.paymentDate)
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
    
            await bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });
        } catch (error) {
            logger.error('Error in checksub command:', error);
            await bot.sendMessage(chatId, "An error occurred while checking the subscription.");
        }
    }

    /**
     * Handle the listgroups command
     */
    async handleListGroups(bot, msg) {
        const chatId = msg.chat.id;
        const adminUsername = msg.from.username;
        
        try {
            if (!this.accessControl.isAdmin(adminUsername)) {
                await bot.sendLongMessage(chatId, "You are not authorized to use this command.");
                return;
            }

            const groups = this.accessControl.getGroupList();
            if (groups.length === 0) {
                await bot.sendLongMessage(chatId, "No groups are currently whitelisted.");
                return;
            }

            let message = "Whitelisted Groups:\n\n";
            for (const group of groups) {
                message += `Group ID: ${group.groupId}\n`;
                message += `Type: ${group.type}\n\n`;
            }
            
            await bot.sendLongMessage(chatId, message);
        } catch (error) {
            logger.error('Error in listgroups command:', error);
            await bot.sendMessage(chatId, "An error occurred while listing groups.");
        }
    }

    /**
     * Handle the listsubs command (List Subscriptions)
     */
    async handleListSubscriptions(bot, msg) {
        const chatId = msg.chat.id;
        const adminUsername = msg.from.username;
    
        try {
            if (!await this.accessControl.isAdmin(adminUsername)) {
                await bot.sendMessage(chatId, "You are not authorized to use this command.");
                return;
            }
    
            const now = new Date();
            const subscriptions = await this.accessControl.subscriptionsCollection
                .find()
                .sort({ username: 1 })
                .toArray();
    
            // Filtrer pour ne garder que les abonnements actifs
            const activeSubscriptions = subscriptions.filter(sub => new Date(sub.expiresAt) > now);
    
            if (activeSubscriptions.length === 0) {
                await bot.sendMessage(chatId, "No active subscriptions found.");
                return;
            }
    
            let message = "📊 Active Subscriptions:\n\n";
            
            for (const sub of activeSubscriptions) {
                const daysLeft = Math.ceil((new Date(sub.expiresAt) - now) / (1000 * 60 * 60 * 24));
                message += `✅ @${sub.username}: ${daysLeft} days left\n`;
            }
    
            message += `\nTotal active subscriptions: ${activeSubscriptions.length}`;
    
            await bot.sendMessage(chatId, message);
    
        } catch (error) {
            logger.error('Error in listsubs command:', error);
            await bot.sendMessage(chatId, "An error occurred while listing subscriptions.");
        }
    }
    /**
     * Handle the removesub command
     */
    async handleRemoveSubscription(bot, msg, args) {
        const chatId = msg.chat.id;
        const adminUsername = msg.from.username;
    
        try {
            if (!await this.accessControl.isAdmin(adminUsername)) {
                await bot.sendMessage(chatId, "You are not authorized to use this command.");
                return;
            }
    
            if (args.length < 1) {
                await bot.sendMessage(chatId, "Usage: /removesub <username>");
                return;
            }
    
            const username = args[0];
            const normalizedUsername = this.accessControl.normalizeUsername(username);
            const subscription = await this.accessControl.getSubscription(username);
    
            if (!subscription) {
                await bot.sendMessage(chatId, `No subscription found for @${username}`);
                return;
            }
    
            // Supprimer complètement l'entrée au lieu de juste la désactiver
            const result = await this.accessControl.subscriptionsCollection.deleteOne(
                { username: normalizedUsername }
            );
    
            if (result.deletedCount > 0) {
                await bot.sendMessage(
                    chatId, 
                    `✅ Subscription successfully removed for @${username}\n` +
                    `Last valid until: ${subscription.expiresAt.toLocaleString()}`
                );
            } else {
                await bot.sendMessage(chatId, `❌ Failed to remove subscription for @${username}`);
            }
        } catch (error) {
            logger.error('Error in removesub command:', error);
            await bot.sendMessage(chatId, "An error occurred while removing the subscription.");
        }
    }

    /**
     * Handle the usagestats command
     */
    async handleUsageStats(bot, msg, usageTracker) {
        const chatId = msg.chat.id;
        const adminUsername = msg.from.username;
        try {
            if (!this.accessControl.isAdmin(adminUsername)) {
                await bot.sendLongMessage(chatId, "You are not authorized to use this command.");
                return;
            }

            const stats = usageTracker.getUsageStats();
            let message = "Command Usage Statistics:\n\n";
            for (const [command, count] of Object.entries(stats)) {
                message += `${command}: ${count} uses\n`;
            }
            await bot.sendLongMessage(chatId, message);
        } catch (error) {
            logger.error('Error in usagestats command:', error);
            await bot.sendMessage(chatId, "An error occurred while fetching usage statistics.");
        }
    }
}

module.exports = AdminCommandHandler;
