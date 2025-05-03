const { analyzeFreshWallets } = require('../../analysis/freshWallets');
const { formatFreshWalletsResult, formatWalletDetails } = require('../formatters/freshWalletFormatter');
const { RequestCache, cachedCommand } = require('../../utils/requestCache');
const logger = require('../../utils/logger');
const stateManager = require('../../utils/stateManager');

class FreshHandler {
  constructor(stateManager) {
      if (!stateManager) throw new Error('StateManager is required');
      this.COMMAND_NAME = 'fresh';
      this.cache = new RequestCache(2 * 60 * 1000);
      this.stateManager = stateManager;
  }

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

  createTrackButton(tokenAddress) {
      return {
          text: "Track Fresh Wallets",
          callback_data: `track:fresh:${tokenAddress}` // Direct format to match expected pattern
      };
  }

  createDetailsButton(tokenAddress) {
      return {
          text: "Show Fresh Wallets Details",
          callback_data: this.generateCallbackData('details', { tokenAddress })
      };
  }

  async handleCommand(bot, msg, args) {
      const chatId = msg.chat.id;

      try {
          const [tokenAddress] = args;
          if (!tokenAddress) {
              await bot.sendMessage(chatId, "Please provide a token address.");
              return;
          }

          const statusMessage = await bot.sendMessage(chatId, "🔍 Fresh wallets analysis in progress... Please wait, this may take a few minutes.");

          const cacheParams = { tokenAddress };
          const fetchFunction = async () => analyzeFreshWallets(tokenAddress, 'freshWallets');

          const { scanData, trackingInfo } = await cachedCommand(
              this.cache,
              '/freshWallets',
              cacheParams,
              fetchFunction
          );

          const formattedResult = formatFreshWalletsResult(
              scanData.analyzedWallets,
              scanData.tokenInfo,
              scanData.freshWallets,
              scanData.totalSupplyControlled
          );

          const trackingData = this.prepareTrackingData(scanData, tokenAddress, chatId);
          stateManager.setTrackingInfo(chatId, tokenAddress, trackingData);

          await bot.deleteMessage(chatId, statusMessage.message_id);

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
              disable_web_page_preview: true
          });

      } catch (error) {
          logger.error('Error in handleFreshWalletsCommand:', error);
          await bot.sendMessage(chatId, `An error occurred during fresh wallets analysis: ${error.message}`);
      }
  }

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

  async handleDetailsView(bot, query, tokenAddress) {
      const chatId = query.message.chat.id;
      const trackingInfo = stateManager.getTrackingInfo(chatId, tokenAddress);

      if (!trackingInfo?.allWalletsDetails) {
          throw new Error("No wallet details found. Please run the analysis again.");
      }

      const message = formatWalletDetails(trackingInfo.allWalletsDetails, trackingInfo.tokenInfo);
      await bot.sendLongMessage(chatId, message, { 
          parse_mode: 'HTML',
          disable_web_page_preview: true
      });
  }

  prepareTrackingData(scanData, tokenAddress, chatId) {
    // Debug log to check the structure of freshWallets
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

module.exports = FreshHandler;