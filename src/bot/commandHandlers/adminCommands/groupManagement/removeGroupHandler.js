// src/bot/commandHandlers/adminCommands/groupManagement/removeGroupHandler.js

const BaseAdminHandler = require('../baseAdminHandler');
const logger = require('../../../../utils/logger');

class RemoveGroupHandler extends BaseAdminHandler {
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

            if (args.length < 1) {
                await this.bot.sendMessage(
                    chatId,
                    "Usage: /removegroup <group_id>"
                );
                return;
            }

            const groupId = args[0];
            
            if (!/^-?\d+$/.test(groupId)) {
                await this.bot.sendMessage(
                    chatId,
                    "Invalid group ID format. Please provide a valid Telegram group ID."
                );
                return;
            }

            await this.accessControl.removeGroup(groupId);
            await this.bot.sendMessage(
                chatId,
                `✅ Group ${groupId} has been removed from whitelist.`
            );
            
            try {
                await this.bot.sendMessage(
                    groupId, 
                    "This group has been removed from the whitelist. " +
                    "Commands will no longer be available in this group chat."
                );
            } catch (error) {
                await this.bot.sendMessage(
                    chatId,
                    "Group was removed but I couldn't send a notification message."
                );
            }
        } catch (error) {
            logger.error('Error in removegroup command:', error);
            await this.bot.sendMessage(
                chatId,
                "❌ An error occurred while removing the group."
            );
        }
    }
}

module.exports = RemoveGroupHandler;