const path = require('path');
const fs = require('fs').promises;
const logger = require('../../utils/logger');

/**
 * @class UserManager
 * @description Gère la persistance des utilisateurs (lecture, écriture, mise à jour).
 */
class UserManager {
    constructor(filePath) {
        this.filePath = filePath;
        this.users = new Map();
    }

    async loadUsers() {
        try {
            const data = await fs.readFile(this.filePath, 'utf8');
            const parsedData = JSON.parse(data);
            // On stocke les utilisateurs en tant que Map
            this.users = new Map(parsedData);
            logger.info(`Loaded ${this.users.size} users from ${this.filePath}`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.error(`File not found: ${this.filePath}`);
            } else {
                logger.error('Error loading users:', error);
            }
        }
    }

    async saveUsers() {
        try {
            // Convertir la Map en tableau avant de JSON-stringify
            await fs.writeFile(this.filePath, JSON.stringify(Array.from(this.users.entries())));
            logger.info(`Saved ${this.users.size} users to ${this.filePath}`);
        } catch (error) {
            logger.error('Error saving users:', error);
        }
    }

    addUser(userId, chatId, username) {
        if (!this.users.has(userId)) {
            this.users.set(userId, { chatId, username, firstSeen: new Date().toISOString() });
            this.saveUsers();
            logger.info(`Added new user: ${userId} (${username})`);
        } else {
            // Mettre à jour les informations si l'utilisateur existe déjà
            const existingUser = this.users.get(userId);
            if (existingUser.chatId !== chatId || existingUser.username !== username) {
                this.users.set(userId, {
                    ...existingUser,
                    chatId,
                    username,
                    lastUpdated: new Date().toISOString()
                });
                this.saveUsers();
                logger.info(`Updated user info: ${userId} (${username})`);
            }
        }
    }

    getUsers() {
        logger.debug(`Getting all users. Current user count: ${this.users.size}`);
        return Array.from(this.users.entries());
    }

    getUserById(userId) {
        return this.users.get(userId);
    }

    getUserByChatId(chatId) {
        return Array.from(this.users.values()).find(user => user.chatId === chatId);
    }

    getUserByUsername(username) {
        // Renvoie un tableau [userId, userObject] ou undefined
        return Array.from(this.users.entries())
            .find(([, user]) => user.username === username);
    }

    debugUsers() {
        logger.debug('Current users in UserManager:', Array.from(this.users.entries()));
        return Array.from(this.users.entries());
    }
}

/**
 * @function initializeUserManager
 * @description Crée et initialise l’instance de UserManager avec le chemin vers `all_users.json`.
 * @returns {Promise<UserManager>}
 */
async function initializeUserManager() {
    const userFilePath = path.join(__dirname, '../data/all_users.json');
    const userManager = new UserManager(userFilePath);
    await userManager.loadUsers();
    return userManager;
}

module.exports = {
    UserManager,
    initializeUserManager
};
