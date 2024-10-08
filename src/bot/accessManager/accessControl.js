// accessControl.js
const fs = require('fs').promises;
const logger = require('../../utils/logger');

class AccessControl {
  constructor(configPath) {
    this.configPath = configPath;
    this.allowedUsers = new Set();
    this.vipUsers = new Set();
    this.adminUsers = new Set();
    this.loadConfig();
  }

  /**
   * Normalize a username by removing the leading "@" and converting to lowercase.
   * @param {string} username - The username to normalize.
   * @returns {string} The normalized username.
   */
  normalizeUsername(username) {
    return username.replace(/^@/, '').toLowerCase();
  }

  /**
   * Load the access control configuration from the file.
   */
  async loadConfig() {
    try {
      const data = await fs.readFile(this.configPath, 'utf8');
      if (data.trim() === '') {
        logger.warn('Access control config file is empty. Initializing with default values.');
        await this.saveConfig();
      } else {
        const config = JSON.parse(data);
        this.allowedUsers = new Set(config.allowedUsers?.map(u => this.normalizeUsername(u)) || []);
        this.vipUsers = new Set(config.vipUsers?.map(u => this.normalizeUsername(u)) || []);
        this.adminUsers = new Set(config.adminUsers?.map(u => this.normalizeUsername(u)) || []);
        logger.info('Access control configuration loaded successfully.');
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        logger.error('Invalid JSON in access control config file. Initializing with default values.', { error });
        await this.saveConfig();
      } else if (error.code === 'ENOENT') {
        logger.warn('Access control config file not found. Creating a new one.');
        await this.saveConfig();
      } else {
        logger.error('Error loading access control config:', { error });
      }
    }
    this.ensureSetInitialization();
    logger.info('Final admin users:', Array.from(this.adminUsers));
  }

  /**
   * Save the access control configuration to the file.
   */
  async saveConfig() {
    try {
      const config = {
        allowedUsers: Array.from(this.allowedUsers),
        vipUsers: Array.from(this.vipUsers),
        adminUsers: Array.from(this.adminUsers)
      };
      await fs.writeFile(this.configPath, JSON.stringify(config, null, 2));
      logger.info('Access control configuration saved successfully.');
    } catch (error) {
      logger.error('Error saving access control config:', { error });
    }
  }

  /**
   * Ensure that all user sets are initialized.
   */
  ensureSetInitialization() {
    this.allowedUsers = this.allowedUsers || new Set();
    this.vipUsers = this.vipUsers || new Set();
    this.adminUsers = this.adminUsers || new Set();
  }

  /**
   * Get the role of a user.
   * @param {string} username - The username to check.
   * @returns {string} The role of the user ('admin', 'vip', 'user', or 'guest').
   */
  getUserRole(username) {
    const normalizedUsername = this.normalizeUsername(username);
    if (this.adminUsers.has(normalizedUsername)) return 'admin';
    if (this.vipUsers.has(normalizedUsername)) return 'vip';
    if (this.allowedUsers.has(normalizedUsername)) return 'user';
    return 'guest';
  }

  /**
   * Check if a user is allowed.
   * @param {string} username - The username to check.
   * @returns {boolean} True if the user is allowed, otherwise false.
   */
  isAllowed(username) {
    const normalizedUsername = this.normalizeUsername(username);
    return this.allowedUsers.has(normalizedUsername) || this.vipUsers.has(normalizedUsername) || this.adminUsers.has(normalizedUsername);
  }

  /**
   * Check if a user is a VIP.
   * @param {string} username - The username to check.
   * @returns {boolean} True if the user is a VIP, otherwise false.
   */
  isVIP(username) {
    const normalizedUsername = this.normalizeUsername(username);
    return this.vipUsers.has(normalizedUsername) || this.adminUsers.has(normalizedUsername);
  }

  /**
   * Check if a user is an admin.
   * @param {string} username - The username to check.
   * @returns {boolean} True if the user is an admin, otherwise false.
   */
  isAdmin(username) {
    const normalizedUsername = this.normalizeUsername(username);
    logger.info(`Checking admin status for: ${normalizedUsername}`);
    logger.info('Admin users:', Array.from(this.adminUsers));
    return this.adminUsers.has(normalizedUsername);
  }

  /**
   * Add a user with a specific role.
   * @param {string} username - The username to add.
   * @param {string} role - The role to assign ('admin', 'vip', 'user').
   */
  async addUser(username, role = 'user') {
    const normalizedUsername = this.normalizeUsername(username);
    if (role === 'admin') {
      this.adminUsers.add(normalizedUsername);
    } else if (role === 'vip') {
      this.vipUsers.add(normalizedUsername);
    } else {
      this.allowedUsers.add(normalizedUsername);
    }
    await this.saveConfig();
    logger.info(`Added user "${normalizedUsername}" as "${role}".`);
  }

  /**
   * Remove a user from all roles.
   * @param {string} username - The username to remove.
   */
  async removeUser(username) {
    const normalizedUsername = this.normalizeUsername(username);
    this.allowedUsers.delete(normalizedUsername);
    this.vipUsers.delete(normalizedUsername);
    this.adminUsers.delete(normalizedUsername);
    await this.saveConfig();
    logger.info(`Removed user "${normalizedUsername}" from all roles.`);
  }
}

module.exports = AccessControl;