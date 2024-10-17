const fs = require('fs').promises;
const logger = require('../../utils/logger');

class UserManager {
    constructor(filePath) {
        this.filePath = filePath;
        this.users = new Map();
    }

    async loadUsers() {
        try {
            const data = await fs.readFile(this.filePath, 'utf8');
            const parsedData = JSON.parse(data);
            this.users = new Map(parsedData);
            logger.info(`Loaded ${this.users.size} users`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.error('File not found:', this.filePath);
            } else {
                logger.error('Error loading users:', error);
            }
        }
    }

    async saveUsers() {
        try {
            await fs.writeFile(this.filePath, JSON.stringify(Array.from(this.users.entries())));
            logger.info(`Saved ${this.users.size} users`);
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
            const user = this.users.get(userId);
            if (user.chatId !== chatId || user.username !== username) {
                this.users.set(userId, { ...user, chatId, username, lastUpdated: new Date().toISOString() });
                this.saveUsers();
                logger.info(`Updated user info: ${userId} (${username})`);
            }
        }
    }

    getUsers() {
        logger.debug(`Getting users. Current user count: ${this.users.size}`);
        return Array.from(this.users.entries());
    }

    getUserById(userId) {
        return this.users.get(userId);
    }

    getUserByChatId(chatId) {
        return Array.from(this.users.values()).find(user => user.chatId === chatId);
    }

    getUserByUsername(username) {
        return Array.from(this.users.entries()).find(([, user]) => user.username === username);
    }

    debugUsers() {
        logger.debug('Current users in UserManager:');
        logger.debug(Array.from(this.users.entries()));
        return Array.from(this.users.entries());
    }
}

module.exports = UserManager;