const fs = require('fs').promises;
const logger = require('../../utils/logger');

class AccessControl {
  constructor(configPath) {
    this.configPath = configPath;
    // User Sets
    this.allowedUsers = new Set();
    this.vipUsers = new Set();
    this.adminUsers = new Set();
    // Group Sets
    this.allowedGroups = new Set();
    this.vipGroups = new Set();
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
   * Normalize a group ID to string format
   * @param {string|number} groupId - The group ID to normalize.
   * @returns {string} The normalized group ID.
   */
  normalizeGroupId(groupId) {
    return String(groupId);
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
        // Load user configurations
        this.allowedUsers = new Set(config.allowedUsers?.map(u => this.normalizeUsername(u)) || []);
        this.vipUsers = new Set(config.vipUsers?.map(u => this.normalizeUsername(u)) || []);
        this.adminUsers = new Set(config.adminUsers?.map(u => this.normalizeUsername(u)) || []);
        // Load group configurations
        this.allowedGroups = new Set(config.allowedGroups?.map(g => this.normalizeGroupId(g)) || []);
        this.vipGroups = new Set(config.vipGroups?.map(g => this.normalizeGroupId(g)) || []);
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
        // User configurations
        allowedUsers: Array.from(this.allowedUsers),
        vipUsers: Array.from(this.vipUsers),
        adminUsers: Array.from(this.adminUsers),
        // Group configurations
        allowedGroups: Array.from(this.allowedGroups),
        vipGroups: Array.from(this.vipGroups)
      };
      await fs.writeFile(this.configPath, JSON.stringify(config, null, 2));
      logger.info('Access control configuration saved successfully.');
    } catch (error) {
      logger.error('Error saving access control config:', { error });
    }
  }

  /**
   * Ensure that all sets are initialized.
   */
  ensureSetInitialization() {
    // User sets
    this.allowedUsers = this.allowedUsers || new Set();
    this.vipUsers = this.vipUsers || new Set();
    this.adminUsers = this.adminUsers || new Set();
    // Group sets
    this.allowedGroups = this.allowedGroups || new Set();
    this.vipGroups = this.vipGroups || new Set();
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
   * Get the type of a group.
   * @param {string|number} groupId - The group ID to check.
   * @returns {string} The type of the group ('vip', 'normal', or null).
   */
  getGroupType(groupId) {
    const normalizedGroupId = this.normalizeGroupId(groupId);
    if (this.vipGroups.has(normalizedGroupId)) return 'vip';
    if (this.allowedGroups.has(normalizedGroupId)) return 'normal';
    return null;
  }

  /**
   * Check if access is allowed based on context
   * @param {string} username - The username to check
   * @param {string|number|null} chatId - The chat ID (null or positive for private, negative for groups)
   * @returns {boolean} True if access is allowed
   */
  isAllowed(username, chatId = null) {
    // For private chats or no chatId provided, check user permissions
    if (!chatId || Number(chatId) > 0) {
      const normalizedUsername = this.normalizeUsername(username);
      return this.allowedUsers.has(normalizedUsername) || 
             this.vipUsers.has(normalizedUsername) || 
             this.adminUsers.has(normalizedUsername);
    }
    
    // For group chats, check both group permissions and user permissions
    const normalizedGroupId = this.normalizeGroupId(chatId);
    return this.allowedGroups.has(normalizedGroupId) || 
           this.vipGroups.has(normalizedGroupId) ||
           this.isAllowed(username); // Check user permissions as fallback
  }

  /**
   * Check if VIP status is granted based on context
   * @param {string} username - The username to check
   * @param {string|number|null} chatId - The chat ID (null or positive for private, negative for groups)
   * @returns {boolean} True if VIP status is granted
   */
  isVIP(username, chatId = null) {
    // For private chats or no chatId provided, check user VIP status
    if (!chatId || Number(chatId) > 0) {
      const normalizedUsername = this.normalizeUsername(username);
      return this.vipUsers.has(normalizedUsername) || 
             this.adminUsers.has(normalizedUsername);
    }
    
    // For group chats, check both group and user VIP status
    const normalizedGroupId = this.normalizeGroupId(chatId);
    return this.vipGroups.has(normalizedGroupId) ||
           this.isVIP(username); // Check user VIP status as fallback
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
   * Add a group with a specific type.
   * @param {string|number} groupId - The group ID to add.
   * @param {string} type - The type to assign ('vip' or 'normal').
   */
  async addGroup(groupId, type = 'normal') {
    const normalizedGroupId = this.normalizeGroupId(groupId);
    
    // Remove from all sets first to prevent duplicates
    this.allowedGroups.delete(normalizedGroupId);
    this.vipGroups.delete(normalizedGroupId);
    
    // Add to appropriate set
    if (type === 'vip') {
      this.vipGroups.add(normalizedGroupId);
    } else {
      this.allowedGroups.add(normalizedGroupId);
    }
    
    await this.saveConfig();
    logger.info(`Added group "${normalizedGroupId}" as "${type}".`);
  }

  /**
   * Remove a group from all types.
   * @param {string|number} groupId - The group ID to remove.
   */
  async removeGroup(groupId) {
    const normalizedGroupId = this.normalizeGroupId(groupId);
    this.allowedGroups.delete(normalizedGroupId);
    this.vipGroups.delete(normalizedGroupId);
    await this.saveConfig();
    logger.info(`Removed group "${normalizedGroupId}" from all types.`);
  }

  /**
   * Get list of all whitelisted groups with their types
   * @returns {Array<{groupId: string, type: string}>} Array of group objects
   */
  getGroupList() {
    const groups = [];
    
    for (const groupId of this.allowedGroups) {
      groups.push({ groupId, type: 'normal' });
    }
    
    for (const groupId of this.vipGroups) {
      groups.push({ groupId, type: 'vip' });
    }
    
    return groups;
  }

  /**
   * Add a user with a specific role.
   * @param {string} username - The username to add.
   * @param {string} role - The role to assign ('admin', 'vip', 'user').
   */
  async addUser(username, role = 'user') {
    const normalizedUsername = this.normalizeUsername(username);
    
    // Remove from all sets first to prevent duplicates
    this.allowedUsers.delete(normalizedUsername);
    this.vipUsers.delete(normalizedUsername);
    this.adminUsers.delete(normalizedUsername);
    
    // Add to appropriate set
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