const BaseHandler = require('./baseHandler');
const { analyzeFreshWallets } = require('../../analysis/freshWallets');
const unifiedFormatter = require('../formatters/unifiedFormatter');
const requestManager = require('../../utils/requestManager');
const { validateSolanaAddress } = require('./helpers');
const logger = require('../../utils/logger');

/**
 * Optimized handler for the /fresh command
 * Analyzes fresh wallets for a token
 */
class FreshHandlerOptimized extends BaseHandler {
  constructor(stateManager) {
    super();
    if (!stateManager) throw new Error('StateManager is required');
    this.stateManager = stateManager;
    this.commandName = 'fresh';
  }

  /**
   * Generate callback data for buttons
   * @param {string} action - Action to perform
   * @param {Object} params - Additional parameters
   * @returns {string} Formatted callback data
   */
  generateCallbackData(action, params = {}) {
    if (action === 'track') {
      // Generate a callback for the tracking handler with the type "fresh"
      return `track:fresh:${params.tokenAddress}`;
    } else if (action === 'details') {
      // Keep details in the FreshHandler
      return `fresh:details:${params.tokenAddress}`;
    }
    return `fresh:${action}:${params.tokenAddress}`;
  }

  /**
   * Create a button for tracking fresh wallets
   * @param {string} tokenAddress - Token address
   * @returns {Object} Button configuration
   */
  createTrackButton(tokenAddress) {
    return {
      text: "Track Fresh Wallets",
      callback_data: `track:fresh:${tokenAddress}`
    };
  }

  /**
   * Create a button for showing details
   * @param {string} tokenAddress - Token address
   * @returns {Object} Button configuration
   */
  createDetailsButton(tokenAddress) {
    return {
      text: "Show Fresh Wallets Details",
      callback_data: this.generateCallbackData('details', { tokenAddress })
    };
  }

  /**
   * Handle the /fresh command
   * @param {Object} bot - The telegram bot instance
   * @param {Object} msg - The message object from Telegram
   * @param {Array} args - Command arguments
   * @param {number|undefined} messageThreadId - The message thread ID if applicable
   */
  async handleCommand(bot, msg, args, messageThreadId) {
    const chatId = msg.chat.id;

    try {
      // Validate arguments
      const validationResult = this.validateArgs(args, {
        minArgs: 1,
        maxArgs: 1,
        required: [0]
      });
      
      if (!validationResult.isValid) {
        await this.sendMessage(
          bot,
          chatId,
          validationResult.errorMessage || "Please provide a token address.",
          { message_thread_id: messageThreadId }
        );
        return;
      }
      
      const [tokenAddress] = args;
      
      // Validate Solana address
      if (!validateSolanaAddress(tokenAddress)) {
        await this.sendMessage(
          bot,
          chatId,
          "Invalid Solana address. Please provide a valid token address.",
          { message_thread_id: messageThreadId }
        );
        return;
      }

      // Show loading message
      const statusMessage = await this.sendMessage(
        bot,
        chatId,
        "🔍 Fresh wallets analysis in progress... Please wait, this may take a few minutes.",
        { message_thread_id: messageThreadId }
      );

      // Create cache key for this analysis
      const cacheKey = `fresh_wallets_${tokenAddress}`;
      
      // Perform analysis with caching
      const result = await requestManager.withCache(
        cacheKey,
        async () => {
          return await analyzeFreshWallets(tokenAddress, 'freshWallets');
        },
        {
          ttl: requestManager.cacheTimes.medium,
          limitType: 'default'
        }
      );

      // Prepare and store tracking data
      const trackingData = this.prepareTrackingData(result.scanData, tokenAddress, chatId);
      this.stateManager.setTrackingInfo(chatId, tokenAddress, trackingData);

      // Delete loading message
      await bot.deleteMessage(chatId, statusMessage.message_id);

      // Format and send result
      const formattedResult = unifiedFormatter.formatFreshWalletsResult(
        result.scanData.analyzedWallets,
        result.scanData.tokenInfo,
        result.scanData.freshWallets,
        result.scanData.totalSupplyControlled
      );

      // Send result with action buttons
      await bot.sendMessage(chatId, formattedResult, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              this.createTrackButton(tokenAddress),
              this.createDetailsButton(tokenAddress)
            ]
          ]
        },
        disable_web_page_preview: true,
        message_thread_id: messageThreadId
      });

    } catch (error) {
      logger.error('Error in fresh command:', error);
      await this.sendMessage(
        bot,
        chatId,
        `An error occurred during fresh wallets analysis: ${error.message}`,
        { message_thread_id: messageThreadId }
      );
    }
  }

  /**
   * Handle callback queries for this command
   * @param {Object} bot - The telegram bot instance
   * @param {Object} query - The callback query
   */
  async handleCallback(bot, query) {
    try {
      const [category, action, tokenAddress] = query.data.split(':');
      
      if (action === 'details') {
        await this.handleDetailsView(bot, query, tokenAddress);
      }
      
      await bot.answerCallbackQuery(query.id);
    } catch (error) {
      logger.error('Error in fresh callback:', error);
      await bot.answerCallbackQuery(query.id, { text: "An error occurred", show_alert: true });
    }
  }

  /**
   * Handle the details view
   * @param {Object} bot - The telegram bot instance
   * @param {Object} query - The callback query
   * @param {string} tokenAddress - The token address
   */
  async handleDetailsView(bot, query, tokenAddress) {
    const chatId = query.message.chat.id;
    const messageThreadId = query.message.message_thread_id;
    const trackingInfo = this.stateManager.getTrackingInfo(chatId, tokenAddress);

    if (!trackingInfo?.allWalletsDetails) {
      throw new Error("No wallet details found. Please run the analysis again.");
    }

    const message = unifiedFormatter.formatFreshWalletDetails(
      trackingInfo.allWalletsDetails, 
      trackingInfo.tokenInfo
    );
    
    await this.sendMessage(
      bot,
      chatId,
      message,
      {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        message_thread_id: messageThreadId
      }
    );
  }

  /**
   * Prepare tracking data from scan results
   * @param {Object} scanData - Scan results
   * @param {string} tokenAddress - Token address
   * @param {string} chatId - Chat ID
   * @returns {Object} Tracking data
   */
  prepareTrackingData(scanData, tokenAddress, chatId) {
    // Log debug information
    logger.debug('Fresh wallets for tracking:', {
      count: scanData.freshWallets?.length || 0,
      sample: scanData.freshWallets?.slice(0, 3) || []
    });
    
    // Ensure we have properly formatted wallet addresses
    const walletAddresses = scanData.freshWallets?.map(wallet => wallet.address || wallet) || [];
    
    logger.debug(`Extracted ${walletAddresses.length} fresh wallet addresses for tracking`);
    
    return {
      tokenAddress,
      trackType: 'fresh',
      tokenInfo: {
        symbol: scanData.tokenInfo.symbol,
        totalSupply: scanData.tokenInfo.totalSupply,
        decimals: scanData.tokenInfo.decimals,
        address: tokenAddress
      },
      totalSupplyControlled: scanData.totalSupplyControlled,
      initialSupplyPercentage: scanData.totalSupplyControlled,
      // These are the wallet addresses we want to track
      wallets: walletAddresses,
      freshWallets: scanData.freshWallets,
      allWalletsDetails: scanData.analyzedWallets,
      chatId
    };
  }
}

module.exports = FreshHandlerOptimized;