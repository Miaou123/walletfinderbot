const logger = require('./logger');

/**
 * Centralized error handling utility
 */
class ErrorHandler {
  /**
   * Handle an error in a command or callback
   * @param {Error} error - The error object
   * @param {string} context - The context where the error occurred (e.g., 'command:start')
   * @param {Object} metadata - Additional metadata about the error
   */
  static handleError(error, context, metadata = {}) {
    const errorInfo = {
      message: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code,
      context,
      ...metadata
    };
    
    logger.error(`Error in ${context}:`, errorInfo);
    
    // Additional error reporting could be added here
    // e.g., sending to an error tracking service
  }

  /**
   * Wrap an async function with error handling
   * @param {Function} fn - The async function to wrap
   * @param {string} context - The context for error reporting
   * @param {Function} onError - Optional function to call on error
   * @returns {Function} Wrapped function with error handling
   */
  static async wrapAsync(fn, context, onError = null) {
    return async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        this.handleError(error, context, { args: args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg) : arg
        ).join(', ') });
        
        if (onError && typeof onError === 'function') {
          return onError(error, ...args);
        }
        
        throw error; // Re-throw if no onError handler
      }
    };
  }

  /**
   * Send an error message to the user
   * @param {Object} bot - The telegram bot instance
   * @param {number|string} chatId - The chat ID to send the message to
   * @param {string} errorType - The type of error
   * @param {Object} options - Additional options (messageThreadId, etc.)
   * @returns {Promise<Object>} The sent message
   */
  static async sendErrorMessage(bot, chatId, errorType = 'general', options = {}) {
    if (!bot || !chatId) {
      logger.error('Cannot send error message: missing bot or chatId');
      return;
    }
    
    const messageThreadId = options.messageThreadId;
    const errorMessages = {
      general: "An error occurred while processing your request. Please try again later.",
      command: "An error occurred while executing this command. Please try again later.",
      subscription: "An error occurred with your subscription. Please contact support.",
      payment: "An error occurred while processing your payment. Please try again or contact support.",
      network: "A network error occurred. Please check your connection and try again.",
      permission: "You don't have permission to use this command.",
      timeout: "The operation timed out. Please try again later.",
      invalid_input: "Invalid input provided. Please check your command parameters and try again.",
      not_found: "The requested information could not be found.",
      rate_limit: "You're making too many requests. Please wait a moment and try again."
    };
    
    const message = errorMessages[errorType] || errorMessages.general;
    
    try {
      return await bot.sendMessage(chatId, message, { 
        parse_mode: 'HTML',
        message_thread_id: messageThreadId,
        ...options
      });
    } catch (error) {
      logger.error('Error sending error message:', error);
    }
  }
}

module.exports = ErrorHandler;