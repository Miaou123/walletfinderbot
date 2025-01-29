// src/bot/commandHandlers/adminCommands/groupManagement/addGroupHandler.js

const BaseAdminHandler = require('../baseAdminHandler');
const logger = require('../../../../utils/logger');

class AddGroupHandler extends BaseAdminHandler {
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

            // Vérifier si nous sommes dans un groupe
            const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
            let targetGroupId;
            let groupType;

            // Obtenir le bot ID
            const botInfo = await this.bot.getMe();
            const botId = botInfo.id;

            if (isGroup) {
                // Dans un groupe
                targetGroupId = msg.chat.id;
                groupType = args.length > 0 ? args[0].toLowerCase() : 'normal';

                if (groupType && !['normal', 'vip'].includes(groupType)) {
                    await this.bot.sendMessage(
                        chatId,
                        "Invalid group type. Use 'normal' or 'vip'."
                    );
                    return;
                }
            } else {
                // En privé, on a besoin de l'ID du groupe et du type
                if (args.length < 2) {
                    const helpMessage = 
                        "Usage in private chat:\n" +
                        "/addgroup <group_id> <type>\n\n" +
                        "Types: normal, vip\n\n" +
                        "Example:\n" +
                        "/addgroup -1001234567890 normal\n\n" +
                        "Note: To add a group directly, execute the command in the target group.";
                    
                    await this.bot.sendMessage(chatId, helpMessage);
                    return;
                }

                targetGroupId = args[0];
                groupType = args[1].toLowerCase();

                if (!['normal', 'vip'].includes(groupType)) {
                    await this.bot.sendMessage(
                        chatId, 
                        "Invalid group type. Use 'normal' or 'vip'."
                    );
                    return;
                }
            }

            // Vérifier l'accès au groupe
            try {
                const chat = await this.bot.getChat(targetGroupId);
                const chatMember = await this.bot.getChatMember(
                    targetGroupId, 
                    botId.toString()
                );
                
                if (!['administrator', 'member'].includes(chatMember.status)) {
                    await this.bot.sendMessage(
                        chatId, 
                        "The bot is not a member of this group. " +
                        "Please add the bot to the group first."
                    );
                    return;
                }

                // Ajouter le groupe
                await this.accessControl.addGroup(targetGroupId, groupType);
                
                // Message de confirmation avec le titre du groupe
                const successMessage = `✅ Group "${chat.title}" has been added as ${groupType}.\nGroup ID: ${targetGroupId}`;
                await this.bot.sendMessage(chatId, successMessage);

                // Si on n'est pas dans le groupe cible, envoyer une confirmation là-bas aussi
                if (chatId !== targetGroupId) {
                    try {
                        await this.bot.sendMessage(
                            targetGroupId,
                            "This group has been whitelisted. " +
                            "All members can now use the bot's commands in this group chat."
                        );
                    } catch (error) {
                        logger.error('Error sending group confirmation:', error);
                        await this.bot.sendMessage(
                            chatId, 
                            "Group was whitelisted but I couldn't send a confirmation message. " +
                            "Make sure the bot has permission to send messages in the group."
                        );
                    }
                }
            } catch (error) {
                logger.error('Error accessing group:', error);
                throw error;
            }

        } catch (error) {
            logger.error('Error in addgroup command:', error);
            await this.bot.sendMessage(
                chatId,
                "❌ An error occurred while adding the group. Please verify the group ID and bot permissions."
            );
        }
    }
}

module.exports = AddGroupHandler;