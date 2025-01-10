// handlers/scanHandler.js
const stateManager = require('../../utils/stateManager');
const { scanToken } = require('../../analysis/topHoldersScanner');
const { formatScanResult } = require('../formatters/scanResultFormatter');
const { validateTrackingData } = require('../../utils/trackingValidator');
const logger = require('../../utils/logger');
const { RequestCache, cachedCommand } = require('../../utils/requestCache');


class ScanHandler {
  constructor() {
      this.COMMAND_NAME = 'scan';
      this.cache = new RequestCache(3 * 60 * 1000);
      this.DEFAULT_HOLDERS = 10;
      this.MAX_HOLDERS = 100;
  }

  generateCallbackData(action, params = {}) {
      // Générer directement le callback 'track:supply:tokenAddress' pour le tracking
      if (action === 'track') {
          return `track:supply:${params.tokenAddress}`;
      }
      return `scan:${action}:${params.tokenAddress}`;
  }

  createTrackButton(tokenAddress) {
      return {
          text: "Track Supply",
          callback_data: this.generateCallbackData('track', { tokenAddress })
      };
  }

  async handleCommand(bot, msg, args) {
      const chatId = msg.chat.id;
      const username = msg.from.username;

      try {
          const [tokenAddress, numberOfHoldersStr] = args;
          
          if (!tokenAddress) {
              await bot.sendMessage(chatId, "Please provide a token address.");
              return;
          }

          const count = parseInt(numberOfHoldersStr) || this.DEFAULT_HOLDERS;
          if (isNaN(count) || count < 1 || count > this.MAX_HOLDERS) {
              await bot.sendMessage(chatId, "Invalid number of holders. Please provide a number between 1 and 100.");
              return;
          }

          const cacheParams = { tokenAddress, count };
          const fetchFunction = async () => scanToken(tokenAddress, count, true, 'scan');

          const scanResult = await cachedCommand(
              this.cache,
              '/scan',
              cacheParams,
              fetchFunction
          );

          if (!scanResult?.scanData) throw new Error("Scan result is incomplete");

          const formattedResult = formatScanResult(
              scanResult.scanData.tokenInfo,
              scanResult.scanData.filteredWallets,
              scanResult.scanData.totalSupplyControlled,
              scanResult.scanData.averagePortfolioValue,
              scanResult.scanData.notableAddresses,
              scanResult.scanData.tokenAddress
          );

          await bot.sendMessage(chatId, formattedResult, {
              parse_mode: 'HTML',
              disable_web_page_preview: true,
              reply_markup: {
                  inline_keyboard: [[
                      this.createTrackButton(tokenAddress)
                  ]]
              }
          });

          if (scanResult.trackingInfo) {
              const trackingData = this.prepareTrackingData(scanResult.trackingInfo, username);
              await this.saveTrackingData(chatId, tokenAddress, trackingData);
          }
      } catch (error) {
          logger.error('Error in handleScanCommand:', error);
          await bot.sendMessage(chatId, `An error occurred during the token scan: ${error.message}`);
      }
  }

  prepareTrackingData(trackingInfo, username) {
      return {
          tokenAddress: trackingInfo.tokenAddress,
          tokenInfo: {
              symbol: trackingInfo.tokenSymbol,
              totalSupply: trackingInfo.totalSupply,
              decimals: trackingInfo.decimals,
          },
          totalSupplyControlled: trackingInfo.totalSupplyControlled,
          initialSupplyPercentage: trackingInfo.totalSupplyControlled,
          topHoldersWallets: trackingInfo.topHoldersWallets,
          teamWallets: [],
          analysisType: 'tokenScanner',
          trackType: 'topHolders',
          username
      };
  }

  async saveTrackingData(chatId, tokenAddress, trackingData) {
      const validationResult = validateTrackingData(trackingData);
      if (!validationResult.isValid) {
          throw new Error(`Invalid tracking data: ${validationResult.message}`);
      }
      stateManager.setTrackingInfo(chatId, tokenAddress, trackingData);
  }
}

module.exports = ScanHandler;