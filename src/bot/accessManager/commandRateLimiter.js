const fs = require('fs').promises;
const path = require('path');

class RateLimiter {
  constructor(filePath) {
    this.filePath = filePath;
    this.limits = new Map();
    this.usage = new Map();
    this.loadUsage();
  }

  async loadUsage() {
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      if (data.trim() === '') {
        console.log('Rate limit usage file is empty. Initializing with an empty object.');
        this.usage = new Map();
        await this.saveUsage();
      } else {
        const savedUsage = JSON.parse(data);
        this.usage = new Map(Object.entries(savedUsage));
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        console.error('Invalid JSON in rate limit usage file. Initializing with an empty object.');
        this.usage = new Map();
        await this.saveUsage();
      } else if (error.code === 'ENOENT') {
        console.log('Rate limit usage file not found. Creating a new one.');
        this.usage = new Map();
        await this.saveUsage();
      } else {
        console.error('Error loading rate limit usage:', error);
        this.usage = new Map();
      }
    }
  }

  async saveUsage() {
    try {
      const usageObject = Object.fromEntries(this.usage);
      await fs.writeFile(this.filePath, JSON.stringify(usageObject, null, 2));
    } catch (error) {
      console.error('Error saving rate limit usage:', error);
    }
  }

  setLimit(command, limit, period) {
    this.limits.set(command, { limit, period });
  }

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
      return false;
    }

    userUsage.count++;
    this.usage.set(key, userUsage);
    this.saveUsage();
    return true;
  }

  async resetDailyLimits() {
    const now = Date.now();
    for (const [key, usage] of this.usage.entries()) {
      if (now > usage.resetTime) {
        this.usage.set(key, { count: 0, resetTime: now + 24 * 60 * 60 * 1000 });
      }
    }
    await this.saveUsage();
  }
}

module.exports = RateLimiter;