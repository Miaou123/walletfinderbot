const fs = require('fs').promises;
const path = require('path');

class UserPreferences {
  constructor() {
    this.preferences = new Map();
    this.lastActivity = new Map();
    this.filePath = path.join(__dirname, 'userPreferences.json');
    this.saveInterval = 5 * 60 * 1000; // 5 minutes
    this.cleanupInterval = 24 * 60 * 60 * 1000; // 24 hours
    this.inactivityThreshold = 30 * 24 * 60 * 60 * 1000; // 30 days

    this.loadPreferences();
    this.startPeriodicSave();
    this.startPeriodicCleanup();
  }

  async loadPreferences() {
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      const parsedData = JSON.parse(data);
      this.preferences = new Map(parsedData.preferences);
      this.lastActivity = new Map(parsedData.lastActivity);
    } catch (error) {
      console.log('No existing preferences file found. Starting with empty preferences.');
    }
  }

  async savePreferences() {
    const data = JSON.stringify({
      preferences: Array.from(this.preferences.entries()),
      lastActivity: Array.from(this.lastActivity.entries())
    });
    await fs.writeFile(this.filePath, data, 'utf8');
    console.log('Preferences saved successfully.');
  }

  startPeriodicSave() {
    setInterval(() => this.savePreferences(), this.saveInterval);
  }

  startPeriodicCleanup() {
    setInterval(() => this.cleanupInactiveUsers(), this.cleanupInterval);
  }

  cleanupInactiveUsers() {
    const now = Date.now();
    for (const [userId, lastActivity] of this.lastActivity.entries()) {
      if (now - lastActivity > this.inactivityThreshold) {
        this.preferences.delete(userId);
        this.lastActivity.delete(userId);
        console.log(`Cleaned up inactive user: ${userId}`);
      }
    }
  }

  getPreferences(userId) {
    this.lastActivity.set(userId, Date.now());
    if (!this.preferences.has(userId)) {
      this.preferences.set(userId, {
        winrateThreshold: 50,
        portfolioThreshold: 10000,
        sortOption: 'port'
      });
    }
    return this.preferences.get(userId);
  }

  updatePreferences(userId, newPreferences) {
    const currentPreferences = this.getPreferences(userId);
    this.preferences.set(userId, { ...currentPreferences, ...newPreferences });
    this.lastActivity.set(userId, Date.now());
  }
}

module.exports = new UserPreferences();