const logger = require('../../utils/logger');

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
            if (!this.accessControl.isAdmin(adminUsername)) {
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

            await this.accessControl.addUser(newUser, role);
            await bot.sendLongMessage(chatId, `User ${newUser} has been added as ${role}.`);
        } catch (error) {
            logger.error('Error in adduser command:', error);
            await bot.sendMessage(msg.chat.id, "An error occurred while adding the user.");
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