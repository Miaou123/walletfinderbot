const BaseAdminHandler = require('../baseAdminHandler');
const { UserService } = require('../../../../database');
const logger = require('../../../../utils/logger');

class RemoveUserHandler extends BaseAdminHandler {
    constructor(accessControl, bot) {
        super(accessControl, bot);
    }

    async handle(msg, args) {
        const chatId = String(msg.chat.id);
        const userId = msg.from.id;

        try {
            // Check if the user is an admin
            if (!await this.checkAdmin(userId)) {
                await this.bot.sendMessage(chatId, "❌ You are not authorized to use this command.");
                return;
            }

            // Validate arguments
            if (args.length < 1) {
                await this.bot.sendMessage(
                    chatId,
                    "Usage: /removeuser <username>"
                );
                return;
            }

            const username = args[0];

            // Check if the user exists
            const existingUser = await UserService.getUser(username);
            if (!existingUser) {
                await this.bot.sendMessage(
                    chatId,
                    `❌ User ${username} not found.`
                );
                return;
            }

            // Delete the user from the database
            await UserService.deleteUser(username);
            
            // Also remove from access control if needed
            try {
                await this.accessControl.removeUser(username);
            } catch (error) {
                logger.warn(`Failed to remove user from access control: ${error.message}`);
                // Continue execution as this is not critical
            }

            await this.bot.sendMessage(
                chatId,
                `✅ User ${username} has been successfully removed.`
            );

        } catch (error) {
            logger.error('Error in /removeuser command:', error);
            await this.bot.sendMessage(
                chatId,
                "❌ An error occurred while removing the user. Please try again."
            );
        }
    }
}

module.exports = RemoveUserHandler;