const logger = require('../../utils/logger');
const errorHandler = require('../../utils/errorHandler');
const responseFormatter = require('../../utils/responseFormatter');

/**
 * Base class for all command handlers
 * Provides common functionality to reduce code duplication
 */
class BaseHandler {
  constructor() {
    this.commandName = this.constructor.name.replace('Handler', '').toLowerCase();
    this.logger = logger;
  }

  /**
   * Main handler method that should be implemented by derived classes
   * @param {Object} bot - The telegram bot instance
   * @param {Object} msg - The message object from Telegram
   * @param {Array} args - Command arguments
   * @param {number|undefined} messageThreadId - The message thread ID if applicable
   */
  async handleCommand(bot, msg, args, messageThreadId) {
    throw new Error('Method not implemented');
  }

  /**
   * Handle callbacks for interactive commands
   * Default implementation that can be overridden
   * @param {Object} bot - The telegram bot instance
   * @param {Object} query - The callback query from Telegram
   */
  async handleCallback(bot, query) {
    this.logger.warn(`${this.constructor.name} does not implement handleCallback`);
    await bot.answerCallbackQuery(query.id, {
      text: "This action is not supported",
      show_alert: true
    });
  }

  /**
   * Send a message with error handling
   * @param {Object} bot - The telegram bot instance
   * @param {number|string} chatId - The chat ID to send to
   * @param {string} message - The message to send
   * @param {Object} options - Additional options for the message
   * @returns {Promise<Object>} The sent message
   */
  async sendMessage(bot, chatId, message, options = {}) {
    try {
      const messageText = message || 'No message content';
      const messageOptions = {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...options
      };
      
      const messageChunks = responseFormatter.splitMessage(messageText);
      
      if (messageChunks.length === 1) {
        return await bot.sendMessage(chatId, messageText, messageOptions);
      }
      
      // Send multiple messages for long responses
      const messages = [];
      for (const chunk of messageChunks) {
        if (chunk.trim().length > 0) {
          const sent = await bot.sendMessage(chatId, chunk, messageOptions);
          messages.push(sent);
        }
      }
      
      return messages[messages.length - 1]; // Return last message
    } catch (error) {
      this.logger.error(`Error sending message in ${this.commandName}:`, error);
      // Try to send a simpler message without HTML formatting
      try {
        return await bot.sendMessage(chatId, 
          "An error occurred while sending the message. Please try again.",
          { message_thread_id: options.message_thread_id }
        );
      } catch (secondError) {
        this.logger.error('Failed to send fallback error message:', secondError);
      }
    }
  }

  /**
   * Send a loading message and then update it with results
   * @param {Object} bot - The telegram bot instance
   * @param {number|string} chatId - The chat ID to send to
   * @param {Function} asyncOperation - The async operation to perform
   * @param {string} loadingMessage - The loading message to show
   * @param {Object} options - Additional options for the message
   * @returns {Promise<any>} The result of the operation
   */
  async sendWithLoading(bot, chatId, asyncOperation, loadingMessage, options = {}) {
    const sentMessage = await this.sendMessage(
      bot, 
      chatId, 
      loadingMessage || `⏳ Processing ${this.commandName} command...`,
      options
    );
    
    try {
      const result = await asyncOperation();
      
      // Update the loading message with the result
      if (sentMessage && sentMessage.message_id) {
        const formattedResult = typeof result === 'string' 
          ? result 
          : responseFormatter.formatCommandResponse(result, this.commandName);
          
        const messageChunks = responseFormatter.splitMessage(formattedResult);
        
        if (messageChunks.length === 1) {
          await bot.editMessageText(formattedResult, {
            chat_id: chatId,
            message_id: sentMessage.message_id,
            parse_mode: 'HTML',
            disable_web_page_preview: true
          });
        } else {
          // For long responses, delete the loading message and send multiple messages
          await bot.deleteMessage(chatId, sentMessage.message_id);
          for (const chunk of messageChunks) {
            if (chunk.trim().length > 0) {
              await this.sendMessage(bot, chatId, chunk, options);
            }
          }
        }
      }
      
      return result;
    } catch (error) {
      // Update the loading message with an error
      if (sentMessage && sentMessage.message_id) {
        await bot.editMessageText(
          responseFormatter.formatErrorMessage(error), 
          {
            chat_id: chatId,
            message_id: sentMessage.message_id
          }
        );
      }
      
      errorHandler.handleError(error, `command:${this.commandName}`, {
        chatId,
        args: options.args
      });
      
      throw error;
    }
  }

  /**
   * Validate command arguments
   * @param {Array} args - The command arguments
   * @param {Object} validationRules - Validation rules for the arguments
   * @returns {Object} Validation result with isValid and errorMessage
   */
  validateArgs(args, validationRules) {
    // Default validation rules
    const defaultRules = {
      minArgs: 0,
      maxArgs: Infinity,
      required: [],
      types: {}
    };
    
    const rules = { ...defaultRules, ...validationRules };
    
    // Check argument count
    if (args.length < rules.minArgs) {
      return {
        isValid: false,
        errorMessage: `This command requires at least ${rules.minArgs} argument(s).`
      };
    }
    
    if (args.length > rules.maxArgs) {
      return {
        isValid: false,
        errorMessage: `This command accepts at most ${rules.maxArgs} argument(s).`
      };
    }
    
    // Check required arguments
    for (const index of rules.required) {
      if (!args[index] || args[index].trim() === '') {
        return {
          isValid: false,
          errorMessage: `Argument ${index + 1} is required.`
        };
      }
    }
    
    // Check argument types
    for (const [index, type] of Object.entries(rules.types)) {
      const arg = args[index];
      
      if (arg !== undefined) {
        if (type === 'number') {
          const num = Number(arg);
          if (isNaN(num)) {
            return {
              isValid: false,
              errorMessage: `Argument ${Number(index) + 1} must be a number.`
            };
          }
        } else if (type === 'boolean') {
          if (arg.toLowerCase() !== 'true' && arg.toLowerCase() !== 'false') {
            return {
              isValid: false,
              errorMessage: `Argument ${Number(index) + 1} must be 'true' or 'false'.`
            };
          }
        } else if (type === 'array') {
          try {
            JSON.parse(arg);
          } catch (e) {
            return {
              isValid: false,
              errorMessage: `Argument ${Number(index) + 1} must be a valid array.`
            };
          }
        }
      }
    }
    
    return { isValid: true, errorMessage: '' };
  }
}

module.exports = BaseHandler;