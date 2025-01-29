// src/bot/commandHandlers/adminCommands/userManagement/removeUserHandler.js

const BaseAdminHandler = require('../baseAdminHandler');
const logger = require('../../../../utils/logger');

class RemoveUserHandler extends BaseAdminHandler {
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
                    "Usage: /removeuser <username>"
                );
                return;
            }

            const userToRemove = args[0];
            await this.accessControl.removeUser(userToRemove);
            await this.bot.sendMessage(
                chatId, 
                `✅ User ${userToRemove} has been removed.`
            );

        } catch (error) {
            logger.error('Error in removeuser command:', error);
            await this.bot.sendMessage(
                chatId,
                "❌ An error occurred while removing the user."
            );
        }
    }
}

module.exports = RemoveUserHandler;