// handlers/trackingActionHandler.js
const logger = require('../../utils/logger');
const stateManager = require('../../utils/stateManager');
const { formatWalletDetails } = require('../formatters/teamSupplyFormatter');

const ACTIONS = {
 TRACK: 'track',
 DETAILS: 'details', 
 SET_DEFAULT: 'sd',
 SET_CUSTOM: 'sc',
 START: 'st',
 STOP: 'stop'
};

class TrackingActionHandler {
 constructor(supplyTracker) {
   if (!supplyTracker) throw new Error('SupplyTracker is required');
   this.supplyTracker = supplyTracker;
 }

 async handleCallback(bot, query) {
    try {
      const [actionType, tokenAddress, trackType] = query.data.split('_');
      const chatId = query.message.chat.id;

      if (actionType === 'stop') {
        await this.handleStopTracking(bot, query, tokenAddress, trackType, query.from.username);
        return;
      }
  
      const trackingInfo = stateManager.getTrackingInfo(chatId, tokenAddress);
      if (!this.validateTrackingInfo(trackingInfo, tokenAddress)) {
        return await this.handleInvalidTracking(bot, query);
      }
  
      await this.executeAction(actionType, bot, query, trackingInfo);
      if (!query.answered) {
        await bot.answerCallbackQuery(query.id);
      }
    } catch (error) {
      await this.handleError(bot, query, error);
    }
  }
  

 validateTrackingInfo(trackingInfo, tokenAddress) {
   return trackingInfo && trackingInfo.tokenAddress === tokenAddress;
 }

 async handleInvalidTracking(bot, query) {
   logger.warn('Invalid tracking info');
   await bot.answerCallbackQuery(query.id, {
     text: "Tracking information outdated. Please run scan again.",
     show_alert: true
   });
 }

 async executeAction(actionType, bot, query, trackingInfo) {
   const chatId = query.message.chat.id;
   const username = query.from.username;
   const tokenAddress = trackingInfo.tokenAddress;
   const threshold = parseFloat(query.data.split('_')[2]);
   const trackType = query.data.split('_')[2] || 'topHolders';

   const actions = {
     [ACTIONS.TRACK]: () => this.handleTrackAction(bot, chatId, tokenAddress, trackingInfo),
     [ACTIONS.DETAILS]: () => this.handleDetails(bot, chatId, trackingInfo),
     [ACTIONS.SET_DEFAULT]: () => this.handleSetDefaultThreshold(bot, chatId, trackingInfo),
     [ACTIONS.SET_CUSTOM]: () => this.handleSetCustomThreshold(bot, chatId, trackingInfo), 
     [ACTIONS.START]: () => this.handleStartTracking(bot, chatId, trackingInfo, threshold, username),
     [ACTIONS.STOP]: () => this.handleStopTracking(bot, query, tokenAddress, trackType, username)
   };

   if (!actions[actionType]) {
     throw new Error(`Unknown action type: ${actionType}`);
   }

   await actions[actionType]();
 }

 async handleError(bot, query, error) {
   logger.error('Error in tracking callback:', error);
   await bot.answerCallbackQuery(query.id, {
     text: "An error occurred", 
     show_alert: true
   });
   if (query.message) {
     await bot.sendMessage(query.message.chat.id, `Error: ${error.message}`);
   }
 }

 async handleTrackAction(bot, chatId, tokenAddress, trackingInfo) {
   const supplyType = trackingInfo.trackType === 'team' ? 'team supply' : 'total supply';
   const message = this.createTrackingMessage(trackingInfo, supplyType);
   const keyboard = this.createTrackingKeyboard(tokenAddress);

   const sentMessage = await bot.sendMessage(chatId, message, {
     reply_markup: keyboard,
     parse_mode: 'HTML'
   });

   trackingInfo.messageId = sentMessage.message_id;
   stateManager.setTrackingInfo(chatId, tokenAddress, trackingInfo);
 }

 async handleDetails(bot, chatId, trackingInfo) {
   if (!trackingInfo?.allWalletsDetails) {
     throw new Error("No wallet details found");
   }
   const message = formatWalletDetails(trackingInfo.allWalletsDetails, trackingInfo.tokenInfo);
   await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
 }

 async handleSetDefaultThreshold(bot, chatId, trackingInfo) {
   trackingInfo.threshold = 1;
   await this.updateTrackingMessage(bot, chatId, trackingInfo);
 }

 async handleSetCustomThreshold(bot, chatId, trackingInfo) {
   await bot.sendMessage(chatId, "Enter new supply change percentage (e.g., 2.5):");
   trackingInfo.awaitingCustomThreshold = true;
   stateManager.setUserState(chatId, {
     action: 'awaiting_custom_threshold',
     trackingId: `${chatId}_${trackingInfo.tokenAddress}`
   });
 }

 async handleStartTracking(bot, chatId, trackingInfo, threshold, username) {
   const { tokenAddress, teamWallets, topHoldersWallets, tokenInfo } = trackingInfo;
   const trackType = trackingInfo.trackType || 'topHolders';
   const wallets = trackType === 'team' ? teamWallets : topHoldersWallets;

   if (!wallets?.length) {
     return await bot.sendMessage(chatId, 
       `Warning: No ${trackType} wallets found. Tracking may not work as expected.`
     );
   }

   try {
     this.supplyTracker.startTracking(
       tokenAddress,
       chatId, 
       wallets,
       trackingInfo.initialSupplyPercentage,
       tokenInfo.totalSupply,
       threshold || 1,
       tokenInfo.symbol,
       tokenInfo.decimals,
       trackType,
       username
     );

     await bot.sendMessage(chatId,
       `Tracking started for ${tokenInfo.symbol} with ${threshold}% threshold. Use /tracker to manage active trackings.`
     );
   } catch (error) {
     logger.error("Error starting tracking:", error);
     await bot.sendMessage(chatId, `Error starting tracking: ${error.message}`);
   }
 }

 async handleStopTracking(bot, query, tokenAddress, trackType, username) {
    const trackerId = `${tokenAddress}_${trackType}`;
    const success = this.supplyTracker.stopTracking(username, trackerId);
  
    if (success) {
      await bot.answerCallbackQuery(query.id, { text: "Tracking stopped successfully." });
      await bot.editMessageText("Tracking stopped. Use /tracker to see current trackers.", {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id
      });
    } else {
      await bot.answerCallbackQuery(query.id, { text: "Failed to stop tracking." });
    }
  }  

 async updateTrackingMessage(bot, chatId, trackingInfo) {
   const message = this.createTrackingMessage(trackingInfo, 
     trackingInfo.trackType === 'team' ? 'team supply' : 'total supply', 
     trackingInfo.threshold);
     
   const keyboard = this.createThresholdKeyboard(
     trackingInfo.tokenAddress, 
     trackingInfo.threshold
   );

   try {
     await bot.editMessageText(message, {
       chat_id: chatId,
       message_id: trackingInfo.messageId,
       reply_markup: keyboard,
       parse_mode: 'HTML'
     });
   } catch (error) {
     logger.error('Error updating tracking message:', error);
   }
 }

 createTrackingMessage(trackingInfo, supplyType, threshold = 1) {
   const baseMessage = `🔁 Ready to track ${trackingInfo.tokenInfo.symbol} ${supplyType} ` +
                      `(${trackingInfo.totalSupplyControlled.toFixed(2)}%)\n\n`;
                      
   return baseMessage + `You will receive a notification when ${supplyType} changes by more than ${threshold}%`;
 }

 createTrackingKeyboard(tokenAddress) {
   return {
     inline_keyboard: [
       [
         { text: "✅1%", callback_data: `sd_${tokenAddress}_1` },
         { text: "Custom %", callback_data: `sc_${tokenAddress}` }
       ],
       [{ text: "Start tracking", callback_data: `st_${tokenAddress}_1` }]
     ]
   };
 }

 createThresholdKeyboard(tokenAddress, threshold) {
   const isDefaultThreshold = threshold === 1;
   return {
     inline_keyboard: [
       [
         { text: isDefaultThreshold ? "✅1%" : "1%", callback_data: `sd_${tokenAddress}_1` },
         { text: !isDefaultThreshold ? `✅${threshold}%` : "Custom %", callback_data: `sc_${tokenAddress}` }
       ],
       [{ text: "Start tracking", callback_data: `st_${tokenAddress}_${threshold}` }]
     ]
   };
 }

    async handleCustomThresholdInput(bot, msg) {
        const chatId = msg.chat.id;
        const userState = stateManager.getUserState(chatId);
        const trackingInfo = stateManager.getTrackingInfo(chatId, userState.trackingId.split('_')[1]);

        const thresholdInput = msg.text.replace('%', '').trim();
        const threshold = parseFloat(thresholdInput);

        if (isNaN(threshold) || threshold < 0.1 || threshold > 100) {
            await bot.sendMessage(chatId, "Invalid input. Please enter a number between 0.1 and 100.");
            return;
        }

        trackingInfo.threshold = threshold;
        trackingInfo.awaitingCustomThreshold = false;
        stateManager.setTrackingInfo(chatId, trackingInfo.tokenAddress, trackingInfo);

        await this.updateTrackingMessage(bot, chatId, trackingInfo);
        stateManager.deleteUserState(chatId);
    }
}

module.exports = TrackingActionHandler;