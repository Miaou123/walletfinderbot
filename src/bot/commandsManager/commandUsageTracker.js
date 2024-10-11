const fs = require('fs').promises;
const path = require('path');
const logger = require('../../utils/logger');

class CommandUsageTracker {
  constructor(filePath) {
    this.filePath = filePath;
    this.usage = new Map();
    this.loadUsage();
  }

  /**
   * Load command usage data from the file.
   */
  async loadUsage() {
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      if (data.trim() === '') {
        logger.warn('Command usage file is empty. Initializing with an empty object.');
        this.usage = new Map();
        await this.saveUsage();
      } else {
        const savedUsage = JSON.parse(data);
        this.usage = new Map(Object.entries(savedUsage));
        logger.info('Command usage data loaded successfully.');
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        logger.error('Invalid JSON in command usage file. Initializing with an empty object.', { error });
        this.usage = new Map();
        await this.saveUsage();
      } else if (error.code === 'ENOENT') {
        logger.warn('Command usage file not found. Creating a new one.');
        this.usage = new Map();
        await this.saveUsage();
      } else {
        logger.error('Error loading command usage file:', { error });
        this.usage = new Map();
      }
    }
  }

  /**
   * Save the command usage data to the file.
   */
  async saveUsage() {
    try {
      const usageObject = Object.fromEntries(this.usage);
      await fs.writeFile(this.filePath, JSON.stringify(usageObject, null, 2));
      logger.info('Command usage data saved successfully.');
    } catch (error) {
      logger.error('Error saving command usage:', { error });
    }
  }

  /**
   * Track command usage for a given username.
   * @param {string} username - The username of the person using the command.
   * @param {string} command - The command being used.
   */
  trackUsage(username, command) {
    try {
      const userUsage = this.usage.get(username) || {};
      userUsage[command] = (userUsage[command] || 0) + 1;
      this.usage.set(username, userUsage);
      this.saveUsage();
      logger.info(`Tracked usage of command "${command}" for user "${username}".`);
    } catch (error) {
      logger.error('Error tracking command usage:', { username, command, error });
    }
  }

  /**
   * Get usage statistics for all tracked commands.
   * @returns {Object} An object containing the usage statistics.
   */
  getUsageStats() {
    try {
      const stats = {};
      for (const [username, userUsage] of this.usage) {
        for (const [command, count] of Object.entries(userUsage)) {
          stats[command] = (stats[command] || 0) + count;
        }
      }
      logger.info('Command usage statistics retrieved successfully.');
      return stats;
    } catch (error) {
      logger.error('Error getting usage statistics:', { error });
      return {};
    }
  }
}

module.exports = CommandUsageTracker;
