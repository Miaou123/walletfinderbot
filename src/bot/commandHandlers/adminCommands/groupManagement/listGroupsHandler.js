// src/bot/commandHandlers/adminCommands/groupManagement/listGroupsHandler.js

const BaseAdminHandler = require('../baseAdminHandler');
const logger = require('../../../../utils/logger');

class ListGroupsHandler extends BaseAdminHandler {
    constructor(accessControl, bot) {
        super(accessControl, bot);
    }

    async handle(msg) {
        const chatId = String(msg.chat.id);
        const userId = msg.from.id;
        
        try {
            if (!await this.checkAdmin(userId)) {
                return;
            }

            const groups = await this.accessControl.getGroupList();
            if (!groups || groups.length === 0) {
                await this.bot.sendMessage(
                    chatId,
                    "📝 No groups are currently whitelisted."
                );
                return;
            }

            let message = "📋 Whitelisted Groups:\n\n";
            for (const group of groups) {
                try {
                    const chat = await this.bot.getChat(group.groupId);
                    message += `👥 Group: ${chat.title}\n`;
                    message += `🆔 ID: ${group.groupId}\n`;
                    message += `📊 Type: ${group.type}\n\n`;
                } catch (error) {
                    message += `👥 Group ID: ${group.groupId}\n`;
                    message += `📊 Type: ${group.type}\n`;
                    message += `ℹ️ Note: Could not fetch group title\n\n`;
                }
            }
            
            await this.bot.sendMessage(chatId, message);
        } catch (error) {
            logger.error('Error in listgroups command:', error);
            await this.bot.sendMessage(
                chatId,
                "❌ An error occurred while listing groups."
            );
        }
    }
}

module.exports = ListGroupsHandler;