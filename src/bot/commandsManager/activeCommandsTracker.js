const logger = require('../../utils/logger');

/**
 * Tracks and manages active commands per user to prevent command spamming
 */
class ActiveCommandsTracker {
  constructor() {
    this.activeCommands = new Map();
    this.TIMEOUT = 10 * 60 * 1000; // 10 minutes
    this.MAX_COMMANDS_PER_USER = 3;
  }

  /**
   * Check if a user can add a new command
   * @param {string} userId - The user ID
   * @param {string} command - The command name
   * @returns {boolean} Whether the user can add the command
   */
  canAddCommand(userId, command) {
    logger.debug(`Checking if command ${command} can be added for user ${userId}`);
    const userCommands = this.activeCommands.get(userId) || new Map();
    const totalCommands = Array.from(userCommands.values()).reduce((sum, cmd) => sum + cmd.count, 0);
    logger.debug(`User ${userId} has ${totalCommands} active commands`);
    return totalCommands < this.MAX_COMMANDS_PER_USER;
  }

  /**
   * Add a command for a user
   * @param {string} userId - The user ID
   * @param {string} command - The command name
   * @returns {boolean} Whether the command was added successfully
   */
  addCommand(userId, command) {
    logger.debug(`Attempting to add command ${command} for user ${userId}`);

    if (!this.activeCommands.has(userId)) {
      this.activeCommands.set(userId, new Map());
    }

    const userCommands = this.activeCommands.get(userId);
    const currentCommand = userCommands.get(command) || { count: 0, timeouts: [] };

    if (currentCommand.count >= this.MAX_COMMANDS_PER_USER) {
      logger.warn(`User ${userId} attempted to start a third instance of command ${command}`);
      return false;
    }

    const timeoutId = setTimeout(() => {
      this.removeCommand(userId, command);
      logger.warn(`Command ${command} for user ${userId} timed out after 10 minutes.`);
    }, this.TIMEOUT);

    currentCommand.count += 1;
    currentCommand.timeouts.push(timeoutId);
    userCommands.set(command, currentCommand);

    const totalCommands = Array.from(userCommands.values()).reduce((sum, cmd) => sum + cmd.count, 0);
    logger.info(`Added command ${command} for user ${userId}. Total active: ${totalCommands}`);
    return true;
  }

  /**
   * Remove a command for a user
   * @param {string} userId - The user ID
   * @param {string} command - The command name
   */
  removeCommand(userId, command) {
    logger.debug(`Attempting to remove command ${command} for user ${userId}`);
    if (!this.activeCommands.has(userId)) {
      logger.warn(`No active commands found for user ${userId}`);
      return;
    }

    const userCommands = this.activeCommands.get(userId);
    const currentCommand = userCommands.get(command);

    if (currentCommand && currentCommand.count > 0) {
      currentCommand.count -= 1;
      const timeoutId = currentCommand.timeouts.shift();
      if (timeoutId) clearTimeout(timeoutId);

      if (currentCommand.count === 0) {
        userCommands.delete(command);
      } else {
        userCommands.set(command, currentCommand);
      }

      const totalCommands = Array.from(userCommands.values()).reduce((sum, cmd) => sum + cmd.count, 0);
      logger.info(`Removed command ${command} for user ${userId}. Remaining active: ${totalCommands}`);

      if (totalCommands === 0) {
        this.activeCommands.delete(userId);
        logger.debug(`Removed user ${userId} from active commands tracking`);
      }
    } else {
      logger.warn(`Command ${command} was not found in active commands for user ${userId}`);
    }
  }

  /**
   * Get the active command count for a user
   * @param {string} userId - The user ID
   * @returns {number} The number of active commands
   */
  getActiveCommandCount(userId) {
    if (!this.activeCommands.has(userId)) return 0;
    const userCommands = this.activeCommands.get(userId);
    const count = Array.from(userCommands.values()).reduce((sum, cmd) => sum + cmd.count, 0);
    logger.debug(`Active command count for user ${userId}: ${count}`);
    return count;
  }

  /**
   * Get all active commands for a user
   * @param {string} userId - The user ID
   * @returns {Array<string>} Array of active command names
   */
  getActiveCommands(userId) {
    if (!this.activeCommands.has(userId)) return [];
    const userCommands = this.activeCommands.get(userId);
    const commands = Array.from(userCommands.entries()).flatMap(([cmd, info]) => 
      Array(info.count).fill(cmd)
    );
    logger.debug(`Active commands for user ${userId}: ${commands.join(', ')}`);
    return commands;
  }

  /**
   * Clear all active commands
   */
  clearAll() {
    // Clear all timeouts first
    for (const [userId, userCommands] of this.activeCommands.entries()) {
      for (const [command, info] of userCommands.entries()) {
        for (const timeoutId of info.timeouts) {
          clearTimeout(timeoutId);
        }
      }
    }
    
    this.activeCommands.clear();
    logger.info('Cleared all active commands');
  }
}

module.exports = new ActiveCommandsTracker();