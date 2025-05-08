const BaseHandler = require('./baseHandler');
const unifiedFormatter = require('../formatters/unifiedFormatter');
const errorHandler = require('../../utils/errorHandler');
const logger = require('../../utils/logger');

/**
 * Command Factory - Creates standardized command handlers with common patterns
 * Reduces code duplication across similar command handlers
 */
class CommandFactory {
  /**
   * Create an analysis command handler
   * @param {Object} config - Command configuration
   * @returns {Object} Command handler instance
   */
  createAnalysisCommand(config) {
    const {
      name,
      description,
      analyzerFn,
      formatFn = null,
      validateFn = null,
      minArgs = 1,
      maxArgs = 2,
      defaultValues = {}
    } = config;
    
    if (!analyzerFn || typeof analyzerFn !== 'function') {
      throw new Error(`Analyzer function is required for analysis command: ${name}`);
    }
    
    // Create a handler class that extends BaseHandler
    class GeneratedHandler extends BaseHandler {
      constructor() {
        super();
        this.commandName = name;
        this.description = description;
        this.minArgs = minArgs;
        this.maxArgs = maxArgs;
        this.defaultValues = defaultValues;
      }
      
      /**
       * Handle the command
       * @param {Object} bot - The telegram bot instance
       * @param {Object} msg - The message object from Telegram
       * @param {Array} args - Command arguments
       * @param {number|undefined} messageThreadId - The message thread ID if applicable
       */
      async handleCommand(bot, msg, args, messageThreadId) {
        logger.info(`Starting ${this.commandName} command for user ${msg.from.username}`);
        
        try {
          // Validate arguments
          const validationResult = this.validateArgs(args, {
            minArgs: this.minArgs,
            maxArgs: this.maxArgs
          });
          
          if (!validationResult.isValid) {
            await this.sendMessage(
              bot,
              msg.chat.id,
              validationResult.errorMessage,
              { message_thread_id: messageThreadId }
            );
            return;
          }
          
          // Additional validation if provided
          if (validateFn) {
            const customValidation = await validateFn(args, this.defaultValues);
            if (!customValidation.isValid) {
              await this.sendMessage(
                bot,
                msg.chat.id,
                customValidation.errorMessage,
                { message_thread_id: messageThreadId }
              );
              return;
            }
          }
          
          // Extract parameters
          const params = this.extractParams(args);
          
          // Execute analysis with loading message
          const result = await this.sendWithLoading(
            bot,
            msg.chat.id,
            async () => {
              return await errorHandler.wrapAsync(
                () => analyzerFn(params, msg.from.username),
                `command:${this.commandName}`
              );
            },
            `⏳ Processing ${this.commandName} command...\n\nAnalyzing ${params.primary}`,
            { message_thread_id: messageThreadId }
          );
          
          // Format and send results
          if (result) {
            const formatter = formatFn || unifiedFormatter.formatWalletList.bind(unifiedFormatter);
            const formattedResult = await formatter(result, params);
            
            if (Array.isArray(formattedResult)) {
              // Send multiple messages
              for (const message of formattedResult) {
                if (message && message.trim()) {
                  await this.sendMessage(
                    bot, 
                    msg.chat.id, 
                    message,
                    { 
                      parse_mode: 'HTML',
                      disable_web_page_preview: true,
                      message_thread_id: messageThreadId
                    }
                  );
                }
              }
            } else if (typeof formattedResult === 'object' && formattedResult.messages) {
              // Send multiple messages from object
              for (const message of formattedResult.messages) {
                if (message && message.trim()) {
                  await this.sendMessage(
                    bot, 
                    msg.chat.id, 
                    message,
                    { 
                      parse_mode: 'HTML',
                      disable_web_page_preview: true,
                      message_thread_id: messageThreadId
                    }
                  );
                }
              }
            } else {
              // Send single message
              await this.sendMessage(
                bot, 
                msg.chat.id, 
                formattedResult,
                { 
                  parse_mode: 'HTML',
                  disable_web_page_preview: true,
                  message_thread_id: messageThreadId
                }
              );
            }
          } else {
            await this.sendMessage(
              bot,
              msg.chat.id,
              "No results found. Try with different parameters.",
              { message_thread_id: messageThreadId }
            );
          }
        } catch (error) {
          logger.error(`Error in ${this.commandName} command:`, error);
          await this.sendMessage(
            bot,
            msg.chat.id,
            `An error occurred while processing your request. Please try again later.`,
            { message_thread_id: messageThreadId }
          );
        }
      }
      
      /**
       * Extract parameters from command arguments
       * @param {Array} args - Command arguments
       * @returns {Object} Extracted parameters
       * @private
       */
      extractParams(args) {
        const params = { ...this.defaultValues };
        
        // Primary parameter (usually token address or wallet address)
        if (args.length > 0) {
          params.primary = args[0];
        }
        
        // Secondary parameter if provided
        if (args.length > 1) {
          params.secondary = args[1];
        }
        
        // Additional parameters
        if (args.length > 2) {
          params.additional = args.slice(2);
        }
        
        return params;
      }
    }
    
    // Return an instance of the generated handler
    return new GeneratedHandler();
  }
  
  /**
   * Create a cross-analysis command handler
   * @param {Object} config - Command configuration
   * @returns {Object} Command handler instance
   */
  createCrossAnalysisCommand(config) {
    const {
      name,
      description,
      analyzerFn,
      formatFn,
      minTokens = 2,
      maxTokens = 5,
      defaultValueThreshold = 10000
    } = config;
    
    if (!analyzerFn || typeof analyzerFn !== 'function') {
      throw new Error(`Analyzer function is required for cross analysis command: ${name}`);
    }
    
    // Create a handler class that extends BaseHandler
    class GeneratedCrossHandler extends BaseHandler {
      constructor() {
        super();
        this.commandName = name;
        this.description = description;
        this.minTokens = minTokens;
        this.maxTokens = maxTokens;
        this.defaultValueThreshold = defaultValueThreshold;
      }
      
      /**
       * Handle the command
       * @param {Object} bot - The telegram bot instance
       * @param {Object} msg - The message object from Telegram
       * @param {Array} args - Command arguments
       * @param {number|undefined} messageThreadId - The message thread ID if applicable
       */
      async handleCommand(bot, msg, args, messageThreadId) {
        logger.info(`Starting ${this.commandName} command for user ${msg.from.username}`);
        
        try {
          if (args.length < this.minTokens) {
            await this.sendMessage(
              bot,
              msg.chat.id,
              `You need to provide at least ${this.minTokens} token addresses for cross analysis.`,
              { message_thread_id: messageThreadId }
            );
            return;
          }
          
          // Extract token addresses and value threshold
          let tokenAddresses = [];
          let valueThreshold = this.defaultValueThreshold;
          
          // Process arguments
          args.forEach(arg => {
            // Check if argument is a value threshold
            if (arg.startsWith('$') && !isNaN(parseFloat(arg.substring(1)))) {
              valueThreshold = parseFloat(arg.substring(1));
            } else {
              // Otherwise treat as token address (up to max tokens)
              if (tokenAddresses.length < this.maxTokens) {
                tokenAddresses.push(arg);
              }
            }
          });
          
          if (tokenAddresses.length < this.minTokens) {
            await this.sendMessage(
              bot,
              msg.chat.id,
              `You need to provide at least ${this.minTokens} valid token addresses.`,
              { message_thread_id: messageThreadId }
            );
            return;
          }
          
          // Execute analysis with loading message
          const result = await this.sendWithLoading(
            bot,
            msg.chat.id,
            async () => {
              return await errorHandler.wrapAsync(
                () => analyzerFn(tokenAddresses, valueThreshold, this.commandName, 'command'),
                `command:${this.commandName}`
              );
            },
            `⏳ Processing ${this.commandName} command...\n\nAnalyzing ${tokenAddresses.length} tokens with threshold $${valueThreshold}`,
            { message_thread_id: messageThreadId }
          );
          
          // Format and send results
          if (result && result.commonWallets && result.commonWallets.length > 0) {
            const formatter = formatFn || unifiedFormatter.formatCrossAnalysis.bind(unifiedFormatter);
            const formattedResult = await formatter(result, { 
              tokenAddresses, 
              valueThreshold 
            });
            
            await this.sendMessage(
              bot, 
              msg.chat.id, 
              formattedResult,
              { 
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                message_thread_id: messageThreadId
              }
            );
          } else {
            await this.sendMessage(
              bot,
              msg.chat.id,
              "No common wallets found with the given parameters. Try lowering the value threshold or use different tokens.",
              { message_thread_id: messageThreadId }
            );
          }
        } catch (error) {
          logger.error(`Error in ${this.commandName} command:`, error);
          await this.sendMessage(
            bot,
            msg.chat.id,
            `An error occurred while processing your request. Please try again later.`,
            { message_thread_id: messageThreadId }
          );
        }
      }
    }
    
    // Return an instance of the generated handler
    return new GeneratedCrossHandler();
  }
}

module.exports = new CommandFactory();