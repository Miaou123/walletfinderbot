const fs = require('fs').promises;
const path = require('path');

class CommandUsageTracker {
  constructor(filePath) {
    this.filePath = filePath;
    this.usage = new Map();
    this.loadUsage();
  }

  async loadUsage() {
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      if (data.trim() === '') {
        console.log('Command usage file is empty. Initializing with an empty object.');
        this.usage = new Map();
        await this.saveUsage();
      } else {
        const savedUsage = JSON.parse(data);
        this.usage = new Map(Object.entries(savedUsage));
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        console.error('Invalid JSON in command usage file. Initializing with an empty object.');
        this.usage = new Map();
        await this.saveUsage();
      } else if (error.code === 'ENOENT') {
        console.log('Command usage file not found. Creating a new one.');
        this.usage = new Map();
        await this.saveUsage();
      } else {
        console.error('Error loading command usage:', error);
        this.usage = new Map();
      }
    }
  }

  async saveUsage() {
    try {
      const usageObject = Object.fromEntries(this.usage);
      await fs.writeFile(this.filePath, JSON.stringify(usageObject, null, 2));
    } catch (error) {
      console.error('Error saving command usage:', error);
    }
  }

  trackUsage(username, command) {
    const userUsage = this.usage.get(username) || {};
    userUsage[command] = (userUsage[command] || 0) + 1;
    this.usage.set(username, userUsage);
    this.saveUsage();
  }

  getUsageStats() {
    const stats = {};
    for (const [username, userUsage] of this.usage) {
      for (const [command, count] of Object.entries(userUsage)) {
        stats[command] = (stats[command] || 0) + count;
      }
    }
    return stats;
  }
}

module.exports = CommandUsageTracker;