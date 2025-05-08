const { commandConfigs, adminCommandConfigs } = require('./commandConfigs');
const logger = require('../../utils/logger');
const crossHandlerOptimized = require('../commandHandlers/crossHandlerOptimized');
const bestTradersHandlerOptimized = require('../commandHandlers/bestTradersHandlerOptimized');
const FreshHandlerOptimized = require('../commandHandlers/freshHandlerOptimized');
const stateManager = require('../../utils/stateManager');

/**
 * CommandRegistry - Centralized registry for all bot commands
 * This class provides a simplified approach to registering and accessing command handlers
 */
class CommandRegistry {
  constructor() {
    this.commandHandlers = new Map();
    this.callbackHandlers = new Map();
    this.aliasMap = this._buildAliasMap();
    
    // Initialize optimized handlers
    const freshHandlerOptimized = new FreshHandlerOptimized(stateManager);
    
    // Register optimized handlers automatically
    this.registerCommand('cross', crossHandlerOptimized.handleCommand.bind(crossHandlerOptimized), crossHandlerOptimized);
    this.registerCommand('besttraders', bestTradersHandlerOptimized.handleCommand.bind(bestTradersHandlerOptimized), bestTradersHandlerOptimized);
    this.registerCommand('fresh', freshHandlerOptimized.handleCommand.bind(freshHandlerOptimized), freshHandlerOptimized);
    
    // Register callback handlers for optimized handlers
    this.registerCallbackHandler('fresh', freshHandlerOptimized);
  }

  /**
   * Build a map of command aliases to their primary command names
   * @returns {Map<string, string>} Map of aliases to command names
   * @private
   */
  _buildAliasMap() {
    const aliasMap = new Map();
    
    // Process regular commands
    Object.entries(commandConfigs).forEach(([command, config]) => {
      if (config.aliases && Array.isArray(config.aliases)) {
        config.aliases.forEach(alias => {
          aliasMap.set(alias.toLowerCase(), command.toLowerCase());
        });
      }
    });
    
    // Process admin commands
    Object.entries(adminCommandConfigs).forEach(([command, config]) => {
      if (config.aliases && Array.isArray(config.aliases)) {
        config.aliases.forEach(alias => {
          aliasMap.set(alias.toLowerCase(), command.toLowerCase());
        });
      }
    });
    
    return aliasMap;
  }

  /**
   * Register a command handler
   * @param {string} commandName - The name of the command
   * @param {Function} handler - The handler function for the command
   * @param {Object} context - The context to bind the handler to
   * @param {boolean} isAdmin - Whether this is an admin command
   */
  registerCommand(commandName, handler, context, isAdmin = false) {
    if (!commandName || typeof handler !== 'function') {
      logger.error(`Invalid command registration: ${commandName}`);
      return;
    }
    
    const normalizedName = commandName.toLowerCase();
    
    this.commandHandlers.set(normalizedName, {
      handler: handler.bind(context || null),
      isAdmin,
      config: isAdmin ? adminCommandConfigs[commandName] : commandConfigs[commandName]
    });
    
    logger.debug(`Registered command "${normalizedName}" successfully`);
    
    // Register aliases if they exist
    const config = isAdmin ? adminCommandConfigs[commandName] : commandConfigs[commandName];
    if (config && config.aliases && Array.isArray(config.aliases)) {
      config.aliases.forEach(alias => {
        // Update alias map
        this.aliasMap.set(alias.toLowerCase(), normalizedName);
        logger.debug(`Registered alias "${alias}" for command "${normalizedName}"`);
      });
    }
  }

  /**
   * Register a callback handler
   * @param {string} category - The callback category
   * @param {Object} handler - The handler object for the callback
   */
  registerCallbackHandler(category, handler) {
    if (!category || !handler || typeof handler.handleCallback !== 'function') {
      logger.error(`Invalid callback handler registration: ${category}`);
      return;
    }
    
    this.callbackHandlers.set(category.toLowerCase(), handler);
    logger.debug(`Registered callback handler for category "${category}" successfully`);
  }

  /**
   * Get a command handler by name or alias
   * @param {string} commandName - The name or alias of the command
   * @returns {Object|null} The command handler or null if not found
   */
  getCommandHandler(commandName) {
    const normalizedName = commandName.toLowerCase();
    
    // Check direct command
    if (this.commandHandlers.has(normalizedName)) {
      return this.commandHandlers.get(normalizedName);
    }
    
    // Check alias
    const primaryCommand = this.aliasMap.get(normalizedName);
    if (primaryCommand && this.commandHandlers.has(primaryCommand)) {
      return this.commandHandlers.get(primaryCommand);
    }
    
    return null;
  }

  /**
   * Get a callback handler by category
   * @param {string} category - The callback category
   * @returns {Object|null} The callback handler or null if not found
   */
  getCallbackHandler(category) {
    return this.callbackHandlers.get(category.toLowerCase()) || null;
  }

  /**
   * Check if a command is registered
   * @param {string} commandName - The name of the command
   * @returns {boolean} Whether the command is registered
   */
  hasCommand(commandName) {
    const normalizedName = commandName.toLowerCase();
    
    return this.commandHandlers.has(normalizedName) || 
           (this.aliasMap.has(normalizedName) && 
            this.commandHandlers.has(this.aliasMap.get(normalizedName)));
  }

  /**
   * Check if a command is an admin command
   * @param {string} commandName - The name of the command
   * @returns {boolean} Whether the command is an admin command
   */
  isAdminCommand(commandName) {
    const handler = this.getCommandHandler(commandName);
    return handler ? handler.isAdmin : false;
  }

  /**
   * Get all registered commands
   * @returns {Array<Object>} Array of command objects
   */
  getAllCommands() {
    return Array.from(this.commandHandlers.entries()).map(([name, data]) => ({
      name,
      isAdmin: data.isAdmin,
      config: data.config
    }));
  }

  /**
   * Get all registered regular commands (non-admin)
   * @returns {Array<Object>} Array of regular command objects
   */
  getRegularCommands() {
    return this.getAllCommands().filter(cmd => !cmd.isAdmin);
  }

  /**
   * Get all registered admin commands
   * @returns {Array<Object>} Array of admin command objects
   */
  getAdminCommands() {
    return this.getAllCommands().filter(cmd => cmd.isAdmin);
  }
}

// Export a singleton instance
module.exports = new CommandRegistry();