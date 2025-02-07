const { analyzeTeamSupply } = require('../../analysis/teamSupply');
const { formatTeamSupplyResult, formatWalletDetails } = require('../formatters/teamSupplyFormatter');
const { RequestCache, cachedCommand } = require('../../utils/requestCache');
const logger = require('../../utils/logger');
const stateManager = require('../../utils/stateManager');

class TeamHandler {
  constructor(stateManager) {
      if (!stateManager) throw new Error('StateManager is required');
      this.COMMAND_NAME = 'team';
      this.cache = new RequestCache(2 * 60 * 1000);
      this.stateManager = stateManager;
  }

  generateCallbackData(action, params = {}) {
      if (action === 'track') {
          // Générer un callback pour le tracking handler avec le type "team"
          return `track:team:${params.tokenAddress}`;
      } else if (action === 'details') {
          // Garder les détails dans le TeamHandler
          return `team:details:${params.tokenAddress}`;
      }
      return `team:${action}:${params.tokenAddress}`;
  }

  createTrackButton(tokenAddress) {
      return {
          text: "Track Team Wallets",
          callback_data: this.generateCallbackData('track', { tokenAddress })
      };
  }

  createDetailsButton(tokenAddress) {
      return {
          text: "Show Team Wallets Details",
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

          const statusMessage = await bot.sendMessage(chatId, "🔍 Team analysis in progress... Please wait, this may take a few minutes.");

          const cacheParams = { tokenAddress };
          const fetchFunction = async () => analyzeTeamSupply(tokenAddress, 'teamSupply');

          const { scanData, trackingInfo } = await cachedCommand(
              this.cache,
              '/teamSupply',
              cacheParams,
              fetchFunction
          );

          const formattedResult = formatTeamSupplyResult(
              scanData.analyzedWallets,
              scanData.tokenInfo,
              scanData.teamWallets,
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
          logger.error('Error in handleTeamSupplyCommand:', error);
          await bot.sendMessage(chatId, `An error occurred during team supply analysis: ${error.message}`);
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
          logger.error('Error in team callback:', error);
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
   return {
     tokenAddress,
     trackType: 'team',
     tokenInfo: {
       symbol: scanData.tokenInfo.symbol,
       totalSupply: scanData.tokenInfo.totalSupply,
       decimals: scanData.tokenInfo.decimals,
     },
     totalSupplyControlled: scanData.totalSupplyControlled,
     initialSupplyPercentage: scanData.totalSupplyControlled,
     topHoldersWallets: [],
     teamWallets: scanData.teamWallets,
     allWalletsDetails: scanData.analyzedWallets,
     chatId
   };
 }
}

module.exports = TeamHandler;