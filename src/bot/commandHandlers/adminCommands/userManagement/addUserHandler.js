// src/bot/commandHandlers/adminCommands/userManagement/addUserHandler.js

const BaseAdminHandler = require('../baseAdminHandler');
const logger = require('../../../../utils/logger');

class AddUserHandler extends BaseAdminHandler {
    constructor(accessControl, bot) {
        super(accessControl, bot);
    }

    async handle(msg, args) {
        const chatId = String(msg.chat.id);
        const userId = msg.from.id;

        try {
            // Vérification admin
            if (!await this.checkAdmin(userId)) {
                return;
            }

            // Validation des arguments
            if (args.length < 2) {
                await this.bot.sendMessage(
                    chatId,
                    "Usage: /adduser <username> <type>\n" +
                    "Types: normal, vip, admin"
                );
                return;
            }

            // Traitement des arguments
            const [newUser, userType] = args;
            const roleMap = { normal: 'user', vip: 'vip', admin: 'admin' };
            const role = roleMap[userType.toLowerCase()];

            if (!role) {
                await this.bot.sendMessage(
                    chatId,
                    "Invalid user type. Available types: normal, vip, admin"
                );
                return;
            }

            // Ajout de l'utilisateur
            await this.accessControl.addUser(newUser, role, null);
            await this.bot.sendMessage(
                chatId, 
                `✅ User ${newUser} has been added as ${role}.`
            );

        } catch (error) {
            logger.error('Error in adduser command:', error);
            await this.bot.sendMessage(
                chatId, 
                "❌ An error occurred while adding the user."
            );
        }
    }
}

module.exports = AddUserHandler;