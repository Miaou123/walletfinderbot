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
        // La structure est bonne mais il faut ajouter le chatId
        const chatId = msg.chat.id;
        const adminUsername = msg.from.username;
    
        try {
            if (!await this.accessControl.isAdmin(adminUsername)) { // Ajout du await
                await bot.sendLongMessage(chatId, "You are not authorized to use this command.");
                return;
            }
    
            if (args.length < 2) {
                await bot.sendLongMessage(chatId, "Usage: /adduser <username> <type>\nTypes: normal, vip, admin");
                return;
            }
    
            const [newUser, userType] = args;
            const roleMap = { normal: 'user', vip: 'vip', admin: 'admin' };
            const role = roleMap[userType.toLowerCase()];
    
            // Ajout du chatId (null car on ne le connait pas encore)
            await this.accessControl.addUser(newUser, role, null);
            await bot.sendLongMessage(chatId, `User ${newUser} has been added as ${role}.`);
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
                await bot.sendLongMessage(chatId, "Usage: /removeuser <username>");
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
                    const helpMessage = "Usage in private chat:\n" +
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
                // D'abord, vérifier si on peut accéder aux informations du groupe
                const chat = await bot.getChat(targetGroupId);
                
                // Ensuite, vérifier si le bot est membre du groupe en utilisant son ID
                const chatMember = await bot.getChatMember(targetGroupId, botId.toString());
                
                if (!['administrator', 'member'].includes(chatMember.status)) {
                    await bot.sendLongMessage(chatId, 
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
                        await bot.sendMessage(targetGroupId, 
                            "This group has been whitelisted. " +
                            "All members can now use the bot's commands in this group chat."
                        );
                    } catch (error) {
                        logger.error('Error sending group confirmation:', error);
                        await bot.sendLongMessage(chatId, 
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
                await bot.sendLongMessage(chatId, 
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
                await bot.sendLongMessage(chatId, "Usage: /removegroup <group_id>");
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
                await bot.sendMessage(groupId, "This group has been removed from the whitelist. Commands will no longer be available in this group chat.");
            } catch (error) {
                await bot.sendLongMessage(chatId, "Group was removed but I couldn't send a notification message.");
            }
        } catch (error) {
            logger.error('Error in removegroup command:', error);
            await bot.sendMessage(chatId, "An error occurred while removing the group.");
        }
    }

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
            logger.info('Admin check passed');
    
            // Les arguments sont séparés par des virgules
            let processedArgs = args.length === 1 ? args[0].split(',').map(arg => arg.trim()) : args;
            logger.info(`Processed args: ${JSON.stringify(processedArgs)}`);
    
            if (processedArgs.length < 3) {
                logger.info('Invalid number of arguments');
                await bot.sendMessage(chatId, 
                    "Usage: /addsub <username> <type> <duration>\n" +
                    "Types: basic, vip\n" +
                    "Durations: 1month, 3month, 6month"
                );
                return;
            }
    
            const [username, type, duration] = processedArgs;
            const normalizedUsername = username.replace(/^@/, '').toLowerCase();
            logger.info(`Processing subscription for user: ${normalizedUsername}, type: ${type}, duration: ${duration}`);
    
            // Vérifier les valeurs valides
            if (!['basic', 'vip'].includes(type.toLowerCase())) {
                logger.info(`Invalid type: ${type}`);
                await bot.sendMessage(chatId, "Invalid type. Use 'basic' or 'vip'.");
                return;
            }
    
            if (!['1month', '3month', '6month'].includes(duration.toLowerCase())) {
                logger.info(`Invalid duration: ${duration}`);
                await bot.sendMessage(chatId, "Invalid duration. Use '1month', '3month' or '6month'.");
                return;
            }
    
            logger.info('Validation passed, checking if user exists in database');
            let user = await this.accessControl.usersCollection.findOne({ username: normalizedUsername });
            logger.info(`User found in database: ${!!user}`);
    
            if (!user) {
                logger.info('Creating new user in database');
                user = {
                    username: normalizedUsername,
                    role: 'user',
                    firstSeen: new Date(),
                    lastUpdated: new Date()
                };
                try {
                    const result = await this.accessControl.usersCollection.insertOne(user);
                    user._id = result.insertedId;
                    logger.info(`New user created with ID: ${user._id}`);
                } catch (error) {
                    logger.error('Error creating user:', error);
                    throw error;
                }
            }
    
            // Créer l'abonnement
            const now = new Date();
            const subscriptionData = {
                userId: user._id.toString(),
                username: normalizedUsername,
                type: type.toLowerCase(),
                duration: duration.toLowerCase(),
                startDate: now,
                expiresAt: new Date(now.getTime() + subscriptionDurations[duration.toLowerCase()]),
                active: true,
                lastUpdated: now,
                paymentId: `test_payment_${Date.now()}`,
                paymentStatus: 'completed',
                metadata: {
                    addedBy: adminUsername,
                    addedFrom: chatId,
                    testSubscription: true
                }
            };
    
            logger.info('Attempting to insert subscription into database');
            logger.debug('Subscription data:', subscriptionData);
    
            try {
                const result = await this.accessControl.subscriptionsCollection.insertOne(subscriptionData);
                logger.info(`Subscription insert result: ${JSON.stringify(result)}`);
    
                if (result.acknowledged) {
                    const message = `Subscription created for ${normalizedUsername}:\n` +
                                  `Type: ${type.toLowerCase()}\n` +
                                  `Duration: ${duration.toLowerCase()}\n` +
                                  `Expires: ${subscriptionData.expiresAt.toLocaleDateString()}`;
                    
                    logger.info('Sending success message to user');
                    await bot.sendMessage(chatId, message);
                    logger.info('Command completed successfully');
                } else {
                    throw new Error('Failed to insert subscription');
                }
            } catch (error) {
                logger.error('Error inserting subscription:', error);
                throw error;
            }
    
        } catch (error) {
            logger.error('Error in addsub command:', error);
            await bot.sendMessage(chatId, "An error occurred while creating the subscription.");
        }
    }
    
    async handleCheckSubscription(bot, msg, args) {
        const chatId = msg.chat.id;
        const adminUsername = msg.from.username;
    
        try {
            if (!await this.accessControl.isAdmin(adminUsername)) {
                await bot.sendLongMessage(chatId, "You are not authorized to use this command.");
                return;
            }
    
            if (args.length < 1) {
                await bot.sendLongMessage(chatId, "Usage: /checksub <username>");
                return;
            }
    
            const username = args[0];
            const subscription = await this.accessControl.getActiveSubscription(username);
            
            if (!subscription) {
                await bot.sendLongMessage(chatId, `No active subscription found for ${username}`);
                return;
            }
    
            await bot.sendLongMessage(chatId, 
                `Subscription info for ${username}:\n` +
                `Type: ${subscription.type}\n` +
                `Duration: ${subscription.duration}\n` +
                `Status: ${subscription.active ? 'Active' : 'Inactive'}\n` +
                `Payment: ${subscription.paymentStatus}\n` +
                `Expires: ${subscription.expiresAt.toLocaleDateString()}`
            );
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

    async handleListSubscriptions(bot, msg, args) {
        const chatId = msg.chat.id;
        const adminUsername = msg.from.username;
    
        try {
            if (!await this.accessControl.isAdmin(adminUsername)) {
                await bot.sendLongMessage(chatId, "You are not authorized to use this command.");
                return;
            }
    
            // Option pour filtrer par type
            let type = args[0]?.toLowerCase();
            if (type && !['basic', 'vip'].includes(type)) {
                type = null;
            }
    
            const filter = {
                active: true,
                expiresAt: { $gt: new Date() }
            };
            
            if (type) {
                filter.type = type;
            }
    
            const subscriptions = await this.accessControl.subscriptionsCollection
                .find(filter)
                .sort({ username: 1 }) // Tri par nom d'utilisateur
                .toArray();
    
            if (subscriptions.length === 0) {
                await bot.sendLongMessage(chatId, 
                    type 
                        ? `No active ${type} subscriptions found.`
                        : "No active subscriptions found."
                );
                return;
            }
    
            let message = "🔄 Active Subscriptions List\n\n";
            
            for (const sub of subscriptions) {
                message += `👤 User: @${sub.username}\n`;
                message += `📋 Type: ${sub.type.toUpperCase()}\n`;
                message += `⏱️ Duration: ${sub.duration}\n`;
                message += `📅 Start Date: ${sub.startDate.toLocaleString()}\n`;
                message += `⚠️ Expires: ${sub.expiresAt.toLocaleString()}\n`;
                message += `💳 Payment ID: ${sub.paymentId || 'N/A'}\n`;
                message += `💰 Payment Status: ${sub.paymentStatus}\n`;
                message += `\n${'─'.repeat(30)}\n\n`;
            }
    
            // Ajouter un résumé à la fin
            const summary = {
                total: subscriptions.length,
                basic: subscriptions.filter(s => s.type === 'basic').length,
                vip: subscriptions.filter(s => s.type === 'vip').length
            };
    
            message += `📊 Summary:\n`;
            message += `Total Active Subscriptions: ${summary.total}\n`;
            message += `Basic Subscriptions: ${summary.basic}\n`;
            message += `VIP Subscriptions: ${summary.vip}\n`;
    
            await bot.sendLongMessage(chatId, message);
        } catch (error) {
            logger.error('Error in listsubs command:', error);
            await bot.sendMessage(chatId, "An error occurred while listing subscriptions.");
        }
    }

    async handleRemoveSubscription(bot, msg, args) {
        const chatId = msg.chat.id;
        const adminUsername = msg.from.username;
    
        try {
            if (!await this.accessControl.isAdmin(adminUsername)) {
                await bot.sendLongMessage(chatId, "You are not authorized to use this command.");
                return;
            }
    
            if (args.length < 1) {
                await bot.sendLongMessage(chatId, "Usage: /removesub <username>");
                return;
            }
    
            const username = args[0];
            const subscription = await this.accessControl.getActiveSubscription(username);
    
            if (!subscription) {
                await bot.sendLongMessage(chatId, `No active subscription found for ${username}`);
                return;
            }
    
            // Désactiver l'abonnement plutôt que de le supprimer
            const result = await this.accessControl.subscriptionsCollection.updateOne(
                { _id: subscription._id },
                { 
                    $set: { 
                        active: false,
                        lastUpdated: new Date()
                    }
                }
            );
    
            if (result.modifiedCount > 0) {
                await bot.sendLongMessage(chatId, 
                    `Subscription removed for ${username}\n` +
                    `Type: ${subscription.type}\n` +
                    `Duration: ${subscription.duration}`
                );
            } else {
                await bot.sendLongMessage(chatId, `Failed to remove subscription for ${username}`);
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