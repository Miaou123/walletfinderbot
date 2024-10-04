// accessControl.js
const fs = require('fs').promises;

class AccessControl {
  constructor(configPath) {
    this.configPath = configPath;
    this.allowedUsers = new Set();
    this.vipUsers = new Set();
    this.adminUsers = new Set();
    this.loadConfig();
  }
  
  normalizeUsername(username) {
    return username.replace(/^@/, '').toLowerCase();
  }

  async loadConfig() {
    try {
      const data = await fs.readFile(this.configPath, 'utf8');
      if (data.trim() === '') {
        console.log('Access control config file is empty. Initializing with default values.');
        await this.saveConfig();
      } else {
        const config = JSON.parse(data);
        this.allowedUsers = new Set(config.allowedUsers?.map(u => this.normalizeUsername(u)) || []);
        this.vipUsers = new Set(config.vipUsers?.map(u => this.normalizeUsername(u)) || []);
        this.adminUsers = new Set(config.adminUsers?.map(u => this.normalizeUsername(u)) || []);
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        console.error('Invalid JSON in access control config file. Initializing with default values.');
        await this.saveConfig();
      } else if (error.code === 'ENOENT') {
        console.log('Access control config file not found. Creating a new one.');
        await this.saveConfig();
      } else {
        console.error('Error loading access control config:', error);
      }
    }
    // Ensure sets are initialized even if there was an error
    this.allowedUsers = this.allowedUsers || new Set();
    this.vipUsers = this.vipUsers || new Set();
    this.adminUsers = this.adminUsers || new Set();
    console.log('Final admin users:', Array.from(this.adminUsers));
  }

  async saveConfig() {
    try {
      const config = {
        allowedUsers: Array.from(this.allowedUsers),
        vipUsers: Array.from(this.vipUsers),
        adminUsers: Array.from(this.adminUsers)
      };
      await fs.writeFile(this.configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      console.error('Error saving access control config:', error);
    }
  }

  normalizeUsername(username) {
    return username.replace(/^@/, '').toLowerCase();
  }

  getUserRole(username) {
    if (this.adminUsers.has(username)) {
        return 'admin';
    } else if (this.vipUsers.has(username)) {
        return 'vip';
    } else if (this.allowedUsers.has(username)) {
        return 'user';
    } else {
        return 'guest'; 
    }
  }

  isAllowed(username) {
    const normalizedUsername = this.normalizeUsername(username);
    return this.allowedUsers.has(normalizedUsername) || 
           this.vipUsers.has(normalizedUsername) || 
           this.adminUsers.has(normalizedUsername);
  }

  isVIP(username) {
    const normalizedUsername = this.normalizeUsername(username);
    return this.vipUsers.has(normalizedUsername) || 
           this.adminUsers.has(normalizedUsername);
  }

  isAdmin(username) {
    const normalizedUsername = this.normalizeUsername(username);
    console.log('Checking admin status for:', normalizedUsername);
    console.log('Admin users:', Array.from(this.adminUsers));
    return this.adminUsers.has(normalizedUsername);
  }

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
  }

  async removeUser(username) {
    const normalizedUsername = this.normalizeUsername(username);
    this.allowedUsers.delete(normalizedUsername);
    this.vipUsers.delete(normalizedUsername);
    this.adminUsers.delete(normalizedUsername);
    await this.saveConfig();
  }
}

module.exports = AccessControl;