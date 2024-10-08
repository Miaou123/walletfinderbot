const fs = require('fs').promises;
const logger = require('../../utils/logger');

class RateLimiter {
  constructor(filePath) {
    this.filePath = filePath;
    this.limits = new Map();
    this.usage = new Map();
    this.loadUsage();
  }

  /**
   * Load rate limit usage data from the file.
   */
  async loadUsage() {
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      if (data.trim() === '') {
        logger.warn('Rate limit usage file is empty. Initializing with an empty object.');
        this.usage = new Map();
        await this.saveUsage();
      } else {
        const savedUsage = JSON.parse(data);
        this.usage = new Map(Object.entries(savedUsage));
        logger.info('Rate limit usage data loaded successfully.');
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        logger.error('Invalid JSON in rate limit usage file. Initializing with an empty object.', { error });
        this.usage = new Map();
        await this.saveUsage();
      } else if (error.code === 'ENOENT') {
        logger.warn('Rate limit usage file not found. Creating a new one.');
        this.usage = new Map();
        await this.saveUsage();
      } else {
        logger.error('Error loading rate limit usage:', { error });
        this.usage = new Map();
      }
    }
  }

  /**
   * Save the rate limit usage data to the file.
   */
  async saveUsage() {
    try {
      const usageObject = Object.fromEntries(this.usage);
      await fs.writeFile(this.filePath, JSON.stringify(usageObject, null, 2));
      logger.info('Rate limit usage data saved successfully.');
    } catch (error) {
      logger.error('Error saving rate limit usage:', { error });
    }
  }

  /**
   * Set the rate limit for a command.
   * @param {string} command - The command to set a limit for.
   * @param {number} limit - The number of allowed executions.
   * @param {number} period - The time period in milliseconds.
   */
  setLimit(command, limit, period) {
    this.limits.set(command, { limit, period });
    logger.info(`Set rate limit for command "${command}" to ${limit} executions per ${period}ms.`);
  }

  /**
   * Check if a command is allowed for a given user.
   * @param {string} username - The username to check.
   * @param {string} command - The command to check.
   * @returns {boolean} True if the command is allowed, otherwise false.
   */
  isAllowed(username, command) {
    const key = `${username}:${command}`;
    const now = Date.now();
    const userUsage = this.usage.get(key) || { count: 0, resetTime: now };
    const limit = this.limits.get(command);

    if (!limit) return true;

    if (now > userUsage.resetTime) {
      userUsage.count = 0;
      userUsage.resetTime = now + limit.period;
    }

    if (userUsage.count >= limit.limit) {
      logger.warn(`Rate limit exceeded for user "${username}" on command "${command}".`);
      return false;
    }

    userUsage.count++;
    this.usage.set(key, userUsage);
    this.saveUsage();
    logger.info(`User "${username}" executed command "${command}". Current count: ${userUsage.count}.`);
    return true;
  }

  /**
   * Reset daily limits for all users.
   */
  async resetDailyLimits() {
    const now = Date.now();
    for (const [key, usage] of this.usage.entries()) {
      if (now > usage.resetTime) {
        this.usage.set(key, { count: 0, resetTime: now + 24 * 60 * 60 * 1000 });
      }
    }
    await this.saveUsage();
    logger.info('Daily limits have been reset for all users.');
  }
}

module.exports = RateLimiter;
