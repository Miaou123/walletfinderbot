const { analyzeTeamSupply } = require('../../analysis/teamSupply');
const { formatTeamSupplyResult, formatWalletDetails } = require('../formatters/teamSupplyFormatter');
const { RequestCache, cachedCommand } = require('../../utils/requestCache');
const logger = require('../../utils/logger');
const stateManager = require('../../utils/stateManager');

// Cancellation token implementation
class CancellationToken {
  constructor() {
    this.cancelled = false;
    this.listeners = [];
  }

  cancel() {
    this.cancelled = true;
    this.listeners.forEach(listener => listener());
  }

  addListener(listener) {
    this.listeners.push(listener);
  }

  isCancelled() {
    return this.cancelled;
  }
}

class TeamHandler {
  constructor(stateManager) {
      if (!stateManager) throw new Error('StateManager is required');
      this.COMMAND_NAME = 'team';
      this.cache = new RequestCache(2 * 60 * 1000);
      this.stateManager = stateManager;
      this.ANALYSIS_TIMEOUT = 30 * 60 * 1000; // 30 minutes timeout for analysis
      this.activeOperations = new Map(); // Track active operations for cancellation
  }

  generateCallbackData(action, params = {}) {
      if (action === 'track') {
          return `track:team:${params.tokenAddress}`;
      } else if (action === 'details') {
          return `team:details:${params.tokenAddress}`;
      } else if (action === 'cancel') {
          return `team:cancel:${params.operationId}`;
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

  createCancelButton(operationId) {
      return {
          text: "❌ Cancel Analysis",
          callback_data: this.generateCallbackData('cancel', { operationId })
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

          // Create a unique operation ID and cancellation token
          const operationId = Math.random().toString(36).substring(2, 8);
          const cancellationToken = new CancellationToken();
          
          // Status message with cancel button
          const statusMessage = await bot.sendMessage(
              chatId, 
              "🔍 Team analysis in progress... Please wait, this may take a few minutes.", 
              {
                  reply_markup: {
                      inline_keyboard: [
                          [this.createCancelButton(operationId)]
                      ]
                  }
              }
          );
          
          // Store the operation in active operations map
          this.activeOperations.set(operationId, {
              cancellationToken,
              tokenAddress,
              chatId,
              statusMessageId: statusMessage.message_id,
              timeoutId: null
          });
          
          logger.info(`Starting team analysis for ${tokenAddress} (ID: ${operationId})`);

          // Set up the timeout (30 minutes)
          const timeoutId = setTimeout(() => {
              logger.warn(`Analysis timeout for ${tokenAddress} (ID: ${operationId})`);
              this.cancelOperation(operationId, "The analysis timed out after 30 minutes.");
          }, this.ANALYSIS_TIMEOUT);
          
          // Store the timeout ID for cleanup
          const operation = this.activeOperations.get(operationId);
          if (operation) {
              operation.timeoutId = timeoutId;
              this.activeOperations.set(operationId, operation);
          }

          try {
              // Pass the cancellation token to the analysis function
              const result = await this.performAnalysis(tokenAddress, cancellationToken, operationId);
              
              // Clean up the operation
              this.cleanupOperation(operationId);
              
              logger.info(`Team analysis completed for ${tokenAddress} (ID: ${operationId})`);

              const { scanData, trackingInfo } = result;

              const formattedResult = formatTeamSupplyResult(
                  scanData.analyzedWallets,
                  scanData.tokenInfo,
                  scanData.teamWallets,
                  scanData.totalSupplyControlled
              );

              const trackingData = this.prepareTrackingData(scanData, tokenAddress, chatId);
              stateManager.setTrackingInfo(chatId, tokenAddress, trackingData);

              // Delete the status message with cancel button
              await bot.deleteMessage(chatId, statusMessage.message_id);

              // Send the result with track and details buttons
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
          } catch (analysisError) {
              // Clean up the operation
              this.cleanupOperation(operationId);
              
              // Check if this was a cancellation or some other error
              if (cancellationToken.isCancelled()) {
                  logger.info(`Team analysis for ${tokenAddress} (ID: ${operationId}) was cancelled`);
                  // The status message was already updated by the cancellation handler
              } else {
                  logger.error(`Team analysis failed for ${tokenAddress} (ID: ${operationId}):`, analysisError);
                  
                  // Delete the status message and inform the user
                  await bot.deleteMessage(chatId, statusMessage.message_id);
                  await bot.sendMessage(chatId, 
                      `Analysis failed for ${tokenAddress}: ${analysisError.message}`
                  );
              }
          }

      } catch (error) {
          logger.error('Error in handleTeamSupplyCommand:', error);
          await bot.sendMessage(chatId, `An error occurred during team supply analysis: ${error.message}`);
      }
  }

  // Handle cancellation of an operation
  async cancelOperation(operationId, reason = "Analysis was cancelled by user.") {
      const operation = this.activeOperations.get(operationId);
      if (!operation) {
          logger.warn(`Attempted to cancel unknown operation: ${operationId}`);
          return false;
      }

      const { cancellationToken, chatId, statusMessageId, timeoutId, tokenAddress } = operation;
      
      // Cancel the operation
      cancellationToken.cancel();
      
      // Clear the timeout
      if (timeoutId) {
          clearTimeout(timeoutId);
      }
      
      try {
          // Update the status message
          await this.bot.editMessageText(
              `🛑 Team analysis for ${tokenAddress} cancelled: ${reason}`,
              {
                  chat_id: chatId,
                  message_id: statusMessageId,
                  reply_markup: { inline_keyboard: [] } // Remove cancel button
              }
          );
      } catch (error) {
          logger.error(`Error updating status message for cancelled operation ${operationId}:`, error);
      }
      
      // Remove from active operations
      this.activeOperations.delete(operationId);
      
      return true;
  }

  // Clean up operation resources
  cleanupOperation(operationId) {
      const operation = this.activeOperations.get(operationId);
      if (!operation) {
          return;
      }
      
      // Clear the timeout if it exists
      if (operation.timeoutId) {
          clearTimeout(operation.timeoutId);
      }
      
      // Remove from active operations
      this.activeOperations.delete(operationId);
  }

  async performAnalysis(tokenAddress, cancellationToken, operationId) {
      // Check if we're cancelled before starting
      if (cancellationToken.isCancelled()) {
          throw new Error('Analysis cancelled');
      }
      
      const cacheParams = { tokenAddress };
      const fetchFunction = async () => {
          logger.debug(`Performing team analysis for ${tokenAddress} (ID: ${operationId})`);
          
          // Track progress for debugging
          const progress = {
              startTime: Date.now(),
              steps: []
          };
          
          // Log progress steps
          const logStep = (step) => {
              const now = Date.now();
              progress.steps.push({
                  step,
                  timestamp: now,
                  elapsed: now - progress.startTime
              });
              logger.debug(`[${operationId}] ${step} (${now - progress.startTime}ms elapsed)`, { tokenAddress });
          };
          
          try {
              // Check for cancellation periodically
              cancellationToken.addListener(() => {
                  throw new Error('Analysis cancelled by user');
              });
              
              logStep('Starting analyzeTeamSupply');
              
              // Pass the cancellation token to the analysis function
              const result = await analyzeTeamSupply(tokenAddress, 'teamSupply', cancellationToken);
              
              // Check again if we've been cancelled
              if (cancellationToken.isCancelled()) {
                  throw new Error('Analysis cancelled');
              }
              
              logStep('Completed analyzeTeamSupply');
              return result;
          } catch (error) {
              logger.error(`Error in team analysis for ${tokenAddress} (ID: ${operationId}):`, error);
              logger.error(`Progress so far:`, progress);
              throw error;
          }
      };

      // We'll handle this directly without the caching wrapper for better cancellation control
      const cacheKey = RequestCache.generateKey('/teamSupply', cacheParams);
      const cachedResult = this.cache.get(cacheKey);
      
      if (cachedResult) {
          logger.debug(`Cache hit for ${cacheKey}`);
          return cachedResult;
      }
      
      logger.debug(`Cache miss for ${cacheKey}, fetching data`);
      const result = await fetchFunction();
      
      // Only cache if we weren't cancelled
      if (!cancellationToken.isCancelled()) {
          this.cache.set(cacheKey, result);
      }
      
      return result;
  }

  async handleCallback(bot, query) {
      try {
          this.bot = bot; // Save reference to bot for cancel operations
          
          const [category, action, param] = query.data.split(':');
          
          if (action === 'details') {
              await this.handleDetailsView(bot, query, param);
              await bot.answerCallbackQuery(query.id);
          } else if (action === 'cancel') {
              // The param is the operationId for cancel action
              const operationId = param;
              const cancelled = await this.cancelOperation(operationId);
              
              if (cancelled) {
                  await bot.answerCallbackQuery(query.id, {
                      text: "Analysis cancelled successfully",
                      show_alert: true
                  });
              } else {
                  await bot.answerCallbackQuery(query.id, {
                      text: "Could not cancel analysis (it may have already completed)",
                      show_alert: true
                  });
              }
          } else {
              await bot.answerCallbackQuery(query.id);
          }
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