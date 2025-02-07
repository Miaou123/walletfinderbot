// src/bot/commandHandlers/adminCommands/systemCommands/broadcastHandler.js

const fs = require('fs');
const path = require('path');
const BaseAdminHandler = require('../baseAdminHandler');
const logger = require('../../../../utils/logger');
const { UserService } = require('../../../../database');

// On remonte 4 fois pour revenir à src/
const allUsersPath = path.join(__dirname, '../../../../data/all_users.json');
logger.info("Reading JSON from:", allUsersPath);

const rawData = fs.readFileSync(allUsersPath, 'utf-8');
logger.info("Raw file content:", rawData); // Ajout
const jsonUsersFromRequire = JSON.parse(rawData);
logger.info('JSON content:', jsonUsersFromRequire);

class BroadcastHandler extends BaseAdminHandler {
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

            const commandLength = '/broadcast '.length;
            const fullMessage = msg.text.slice(commandLength);

            if (!fullMessage) {
                await this.bot.sendMessage(
                    chatId,
                    "Usage: /broadcast <message>\nPlease provide a message to broadcast."
                );
                return;
            }

            const { successCount, failCount } = await this.broadcastMessage(fullMessage);
            await this.bot.sendMessage(
                chatId,
                `📢 Broadcast Results:\n` +
                `✅ Successfully sent: ${successCount}\n` +
                `❌ Failed: ${failCount}`
            );
        } catch (error) {
            logger.error('Error in broadcast:', error.message || error);
            await this.bot.sendMessage(
                chatId,
                "❌ An error occurred while broadcasting the message."
            );
        }
    }

    async broadcastMessage(message) {
        logger.info('Starting broadcast');

        let successCount = 0;
        let failCount = 0;
        // Set pour éviter double envoi pour le même username (en minuscule)
        const broadcastedUsernames = new Set();

        try {
            //
            // 1) Diffusion via la base de données
            //
            const collection = await UserService.getCollection();
            const users = await collection.find({}, { projection: { chatId: 1, username: 1 } }).toArray();

            logger.info(`Retrieved ${users.length} users from DB for broadcasting`);

            for (const user of users) {
                const chatIdNum = Number(user.chatId);
                // Normaliser le username en minuscule
                const normalizedUsername = user.username ? user.username.toLowerCase() : null;

                // Vérifier si l'utilisateur a un chatId valide
                if (chatIdNum > 0 && normalizedUsername && !broadcastedUsernames.has(normalizedUsername)) {
                    try {
                        logger.info(`Attempting to send message to user ${user.username} (${chatIdNum})`);

                        await this.bot.sendMessage(chatIdNum, message, {
                            parse_mode: 'HTML',
                            disable_web_page_preview: true
                        });

                        successCount++;
                        logger.info(`Successfully sent broadcast to user ${user.username}`);

                        // Ajouter au set pour éviter un second envoi
                        broadcastedUsernames.add(normalizedUsername);

                        // Délai pour éviter les limites de rate de Telegram
                        await new Promise(resolve => setTimeout(resolve, 100));
                    } catch (error) {
                        failCount++;
                        logger.error(
                            `Failed to send broadcast to user ${user.username}:`,
                            error.message || error
                        );
                    }
                } else {
                    logger.info(`Skipping user ${user.username} - already broadcasted, no username, or invalid chat ID`);
                }
            }

            //
            // 2) Diffusion via l'ancien fichier JSON (data/all_users.json)
            //
            let jsonUsers;
            try {
                const rawData = fs.readFileSync(allUsersPath, 'utf-8');
                jsonUsers = JSON.parse(rawData);
            } catch (error) {
                logger.error('Failed to read or parse data/all_users.json:', error.message || error);
                jsonUsers = []; // On continue quand même, même si le fichier JSON n'est pas valide
            }

            if (Array.isArray(jsonUsers)) {
                logger.info(`Retrieved ${jsonUsers.length} users from JSON for broadcasting`);

                for (const [_, userObj] of jsonUsers) {
                    if (!userObj) continue;
                    
                    const chatIdNum = Number(userObj.chatId);
                    // Normaliser le username en minuscule
                    const normalizedUsername = userObj.username ? userObj.username.toLowerCase() : null;

                    if (chatIdNum > 0 && normalizedUsername && !broadcastedUsernames.has(normalizedUsername)) {
                        try {
                            logger.info(`Attempting to send message to user ${userObj.username} (${chatIdNum})`);

                            await this.bot.sendMessage(chatIdNum, message, {
                                parse_mode: 'HTML',
                                disable_web_page_preview: true
                            });

                            successCount++;
                            logger.info(`Successfully sent broadcast to user ${userObj.username}`);

                            broadcastedUsernames.add(normalizedUsername);

                            // Délai pour éviter les limites de rate de Telegram
                            await new Promise(resolve => setTimeout(resolve, 100));
                        } catch (error) {
                            failCount++;
                            logger.error(
                                `Failed to send broadcast to user ${userObj.username}:`,
                                error.message || error
                            );
                        }
                    } else {
                        logger.info(`Skipping user from JSON ${userObj.username} - already broadcasted, no username, or invalid chat ID`);
                    }
                }
            } else {
                logger.warn('JSON users data is not an array. Skipping JSON broadcast...');
            }

            logger.info(`Broadcast complete. Successful: ${successCount}, Failed: ${failCount}`);
            return { successCount, failCount };
        } catch (error) {
            logger.error('Error retrieving or sending broadcast:', error);
            throw error;
        }
    }
}

module.exports = BroadcastHandler;
