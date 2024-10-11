const fs = require('fs').promises;
const logger = require('../../utils/logger');

class UserManager {
    constructor(filePath) {
        this.filePath = filePath;
        this.users = new Map();
    }

    async loadUsers() {
        console.log('Attempting to load users from:', this.filePath);
        try {
            const data = await fs.readFile(this.filePath, 'utf8');
            console.log('Raw data read from file:', data);
            const parsedData = JSON.parse(data);
            console.log('Parsed data:', parsedData);
            this.users = new Map(parsedData);
            console.log('Users loaded into Map. Size:', this.users.size);
            logger.info(`Loaded ${this.users.size} users`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log('File not found:', this.filePath);
                logger.info('No users file found. Starting with empty user list.');
            } else {
                console.error('Error loading users:', error);
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
        console.log('Current users in UserManager:');
        console.log(Array.from(this.users.entries()));
        return Array.from(this.users.entries());
    }
}

module.exports = UserManager;