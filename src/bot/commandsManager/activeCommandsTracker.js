const logger = require('../../utils/logger');
const { commandConfigs } = require('./commandParser');

class ActiveCommandsTracker {
  constructor() {
    this.activeCommands = new Map();
    this.TIMEOUT = 10 * 60 * 1000;
  }

  canAddCommand(userId, command) {
    logger.debug(`Checking if command ${command} can be added for user ${userId}`);
    const userCommands = this.activeCommands.get(userId) || new Map();
    const totalCommands = Array.from(userCommands.values()).reduce((sum, cmd) => sum + cmd.count, 0);
    logger.debug(`User ${userId} has ${totalCommands} active commands`);
    return totalCommands < 3;
  }

  addCommand(userId, command) {
    logger.debug(`Attempting to add command ${command} for user ${userId}`);

    if (!this.activeCommands.has(userId)) {
      this.activeCommands.set(userId, new Map());
    }

    const userCommands = this.activeCommands.get(userId);
    const currentCommand = userCommands.get(command) || { count: 0, timeouts: [] };

    if (currentCommand.count >= 3) {
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

  getActiveCommandCount(userId) {
    if (!this.activeCommands.has(userId)) return 0;
    const userCommands = this.activeCommands.get(userId);
    const count = Array.from(userCommands.values()).reduce((sum, cmd) => sum + cmd.count, 0);
    logger.debug(`Active command count for user ${userId}: ${count}`);
    return count;
  }

  getActiveCommands(userId) {
    if (!this.activeCommands.has(userId)) return [];
    const userCommands = this.activeCommands.get(userId);
    const commands = Array.from(userCommands.entries()).flatMap(([cmd, info]) => 
      Array(info.count).fill(cmd)
    );
    logger.debug(`Active commands for user ${userId}: ${commands.join(', ')}`);
    return commands;
  }
}

module.exports = new ActiveCommandsTracker();