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
  constructor(supplyTracker, accessControl) {
    if (!supplyTracker) throw new Error('SupplyTracker is required');
    if (!accessControl) throw new Error('AccessControl is required');
    if (!accessControl.subscriptionService?.getUserSubscription || 
        !accessControl.subscriptionService?.getGroupSubscription) {
        throw new Error('AccessControl must have subscriptionService with required methods');
    }
    
    this.supplyTracker = supplyTracker;
    this.accessControl = accessControl;
}

generateCallbackData(action, params = {}) {
  // Format standard: track:action:tokenAddress[:extraParam]
  let callbackData = `track:${action}:${params.tokenAddress}`;
  
  if (params.threshold) {
    callbackData += `:${params.threshold}`;
  }
  if (params.trackType) {
    callbackData += `:${params.trackType}`;
  }
  
  return callbackData;
}

async handleCallback(bot, query) {
  try {
      const [category, action, tokenAddress, threshold] = query.data.split(':');
      const chatId = query.message.chat.id.toString();
      const userId = query.from.id.toString();
      const isGroup = query.message.chat.type === 'group' || query.message.chat.type === 'supergroup';

      logger.debug('TrackingActionHandler callback received:', {
          isGroup,
          chatId,
          userId,
          action,
          tokenAddress
      });

      // Check subscription before any tracking action
      let hasSubscription;
      if (isGroup) {
          const groupSub = await this.accessControl.subscriptionService.getGroupSubscription(chatId);
          hasSubscription = groupSub?.active === true && groupSub.expiresAt > new Date();
      } else {
          const userSub = await this.accessControl.subscriptionService.getUserSubscription(userId);
          hasSubscription = userSub?.active === true && userSub.expiresAt > new Date();
      }

      logger.debug('Subscription check result:', {
          hasSubscription,
          isGroup,
          chatId,
          userId
      });

      if (!hasSubscription) {
          await bot.answerCallbackQuery(query.id);
          await bot.sendMessage(chatId,
              "🔒 This command requires an active subscription\n\n" +
              "• Use /subscribe to view our subscription plans\n" +
              "• Try /preview to test our features before subscribing\n\n" +
              "Need help? Contact @Rengon0x for support"
          );
          return;
      }

      if (action === 'stop') {
        await this.executeAction(action, bot, query, { tokenAddress });
        return;
      }

      // Initial tracking from scan or team
      if (action === 'supply' || action === 'team') {
          const trackType = action === 'team' ? 'team' : 'topHolders';
          let trackingInfo = stateManager.getTrackingInfo(chatId, tokenAddress);
          
          logger.debug('Retrieved tracking info for initial action:', trackingInfo 
              ? { trackType: trackingInfo.trackType, tokenSymbol: trackingInfo.tokenInfo?.symbol } 
              : 'No tracking info found');

          if (!this.validateTrackingInfo(trackingInfo, tokenAddress)) {
              logger.warn('Invalid tracking info detected for initial action');
              return await this.handleInvalidTracking(bot, query);
          }

          trackingInfo.trackType = trackType;
          // Store the query user ID for later use in private chats
          trackingInfo.queryFromId = userId;
          await this.handleTrackAction(bot, chatId, tokenAddress, trackingInfo);
      }
      // Actions de configuration et contrôle (sd, sc, st, stop)
      else {
          let trackingInfo = stateManager.getTrackingInfo(chatId, tokenAddress);

          if (!this.validateTrackingInfo(trackingInfo, tokenAddress)) {
              logger.warn('Invalid tracking info detected for configuration action');
              return await this.handleInvalidTracking(bot, query);
          }

          // Store the query user ID for later use in private chats
          trackingInfo.queryFromId = userId;
          await this.executeAction(action, bot, query, trackingInfo);
      }
      
      if (!query.answered) {
          await bot.answerCallbackQuery(query.id);
      }
  } catch (error) {
      await this.handleError(bot, query, error);
  }
}

  validateTrackingInfo(trackingInfo, tokenAddress) {
    logger.debug('Validating tracking info:', JSON.stringify(trackingInfo, null, 2));
    logger.debug(`Token address to validate: ${tokenAddress}`);
    const isValid = trackingInfo && (
        trackingInfo.tokenAddress === tokenAddress || 
        tokenAddress.includes(trackingInfo.tokenAddress)
    );
    logger.debug(`Tracking info validation result: ${isValid}`);
    return isValid;
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
  const tokenAddress = trackingInfo.tokenAddress || query.data.split(':')[2];
  const threshold = query.data.split(':')[3];
  const trackType = trackingInfo.trackType || 'topHolders';

  const actions = {
    [ACTIONS.TRACK]: () => this.handleTrackAction(bot, chatId, tokenAddress, trackingInfo),
    [ACTIONS.DETAILS]: () => this.handleDetails(bot, chatId, trackingInfo),
    [ACTIONS.SET_DEFAULT]: () => this.handleSetDefaultThreshold(bot, chatId, trackingInfo),
    [ACTIONS.SET_CUSTOM]: () => this.handleSetCustomThreshold(bot, chatId, trackingInfo), 
    [ACTIONS.START]: () => this.handleStartTracking(bot, chatId, trackingInfo, threshold),
    [ACTIONS.STOP]: () => this.handleStopTracking(bot, query, tokenAddress, trackType)
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
    // Cette fonction est appelée par le callback button
    const isGroup = String(chatId).startsWith('-');
    
    await bot.sendMessage(chatId, "Enter new supply change percentage (e.g., 2.5):");
    
    // Add debug logging
    logger.debug('In handleSetCustomThreshold:', {
      tokenAddress: trackingInfo.tokenAddress,
      chatId,
      isGroup,
      messageSent: true
    });
    
    if (isGroup) {
      // For group chats, use a special group key to track the state
      const stateKey = `grp_${chatId}`;
      stateManager.setUserState(stateKey, {
          action: 'awaiting_custom_threshold',
          tokenAddress: trackingInfo.tokenAddress,
          startTime: Date.now()
      });
      
      logger.debug('Set group threshold state with key:', stateKey);
    } else {
      // For private chats, track state with user ID directly from query
      const userId = trackingInfo.queryFromId;
      if (userId) {
        stateManager.setUserState(userId, {
            action: 'awaiting_custom_threshold',
            tokenAddress: trackingInfo.tokenAddress,
            startTime: Date.now()
        });
        logger.debug('Set private chat threshold state for user:', userId);
      } else {
        logger.error('No user ID available for private chat threshold tracking');
      }
    }
  }

  async handleCustomThresholdInput(bot, msg) {
    // Cette fonction est appelée par handleNonCommand
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username || String(userId);
    const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
    
    logger.debug('Processing custom threshold input:', {
      text: msg.text,
      fromUser: username,
      chatId,
      isGroup
    });
    
    // Check for user-specific state first
    let userState = stateManager.getUserState(userId);
    
    // If in a group chat and no user state, check for group state
    let groupState = null;
    if (isGroup) {
      const groupStateKey = `grp_${chatId}`;
      groupState = stateManager.getUserState(groupStateKey);
      
      // If we have group state but no user state, this is likely the first
      // response to the prompt - set up user state now
      if (groupState && !userState) {
        logger.debug('Found group state but no user state. Setting up user state for group responder', {
          groupStateKey,
          fromUser: username
        });
        userState = groupState;
      }
    }
    
    // Log the state we're working with
    logger.debug('State for threshold handling:', {
      hasUserState: !!userState,
      hasGroupState: !!groupState,
      stateSource: userState?.isRespondingToGroup ? 'group-linked' : (userState ? 'user' : 'none')
    });

    // Ensure we have valid state with token address
    if (!userState?.tokenAddress) {
        logger.debug('No valid state with token address');
        await bot.sendMessage(chatId, "Session expired. Please run the scan command again.");
        return;
    }

    // Parse and validate the threshold input
    const thresholdInput = msg.text.replace('%', '').trim();
    const threshold = parseFloat(thresholdInput);

    if (isNaN(threshold) || threshold < 0.1 || threshold > 100) {
        logger.debug('Invalid threshold value:', thresholdInput);
        await bot.sendMessage(chatId, "Invalid threshold. Please enter a number between 0.1 and 100.");
        return;
    }

    // Get tracking info using the token address from state
    const trackingInfo = stateManager.getTrackingInfo(chatId, userState.tokenAddress);
    if (!trackingInfo) {
        logger.debug('No tracking info found for token:', userState.tokenAddress);
        await bot.sendMessage(chatId, "Tracking information expired. Please run the scan command again.");
        return;
    }

    // Log tracking info before update
    logger.debug('Found tracking info:', {
      tokenAddress: trackingInfo.tokenAddress,
      currentThreshold: trackingInfo.threshold,
      messageId: trackingInfo.messageId,
      newThreshold: threshold
    });

    // Update tracking info with new threshold
    trackingInfo.threshold = threshold;
    stateManager.setTrackingInfo(chatId, userState.tokenAddress, trackingInfo);

    // Update the tracking message with new threshold
    await this.updateTrackingMessage(bot, chatId, trackingInfo);
    
    // Clean up all states
    if (isGroup) {
      // Clean up group state
      const groupStateKey = `grp_${chatId}`;
      stateManager.deleteUserState(groupStateKey);
      
      // If this user was linked to group state, clean up their state too
      if (userState.isRespondingToGroup) {
        stateManager.deleteUserState(userId);
      }
      
      // If there was a specific user recorded as responding, clean up their state too
      if (groupState?.respondingUserId && groupState.respondingUserId !== userId) {
        stateManager.deleteUserState(groupState.respondingUserId);
      }
    } else {
      // Just clean up this user's state in private chat
      stateManager.deleteUserState(userId);
    }
    
    logger.debug('Threshold updated successfully:', {
      newThreshold: threshold,
      tokenAddress: trackingInfo.tokenAddress
    });
  }

 async handleStartTracking(bot, chatId, trackingInfo, threshold) {
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
     );

     await bot.sendMessage(chatId,
       `Tracking started for ${tokenInfo.symbol} with ${threshold}% threshold. Use /tracker to manage active trackings.`
     );
   } catch (error) {
     logger.error("Error starting tracking:", error);
     await bot.sendMessage(chatId, `Error starting tracking: ${error.message}`);
   }
 }

  // Modification de handleStopTracking pour inclure le chatId
  async handleStopTracking(bot, query, tokenAddress) {
    const chatId = query.message.chat.id; 
    const trackedSupplies = this.supplyTracker.getTrackedSuppliesByUser(chatId);
    logger.debug('Available trackers:', JSON.stringify(trackedSupplies));

    // Récupérer le tracker qui contient déjà le trackType
    const tracker = this.supplyTracker.getTrackedSuppliesByUser(chatId)
    .find(t => t.tokenAddress === tokenAddress);
    
    if (!tracker) {
        await bot.answerCallbackQuery(query.id, { 
            text: "No matching tracker found.", 
            show_alert: true 
        });
        return;
    }

    const trackerId = `${tokenAddress}_${tracker.trackType}`;
    
    try {
      const success = this.supplyTracker.stopTracking(chatId, trackerId);
      
      if (success) {
        await bot.answerCallbackQuery(query.id, { 
          text: "Tracking stopped successfully." 
        });
        await bot.editMessageText(
          "Tracking stopped. Use /tracker to see current trackers.", 
          {
            chat_id: chatId,
            message_id: query.message.message_id
          }
        );
      } else {
        await bot.answerCallbackQuery(query.id, { 
          text: "No matching tracker found.", 
          show_alert: true 
        });
      }
    } catch (error) {
      logger.error('Error stopping tracking:', error);
      await bot.answerCallbackQuery(query.id, { 
        text: "An unexpected error occurred.",
        show_alert: true 
      });
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
                { 
                    text: "✅1%", 
                    callback_data: `track:${ACTIONS.SET_DEFAULT}:${tokenAddress}:1` 
                },
                { 
                    text: "Custom %", 
                    callback_data: `track:${ACTIONS.SET_CUSTOM}:${tokenAddress}` 
                }
            ],
            [{ 
                text: "Start tracking", 
                callback_data: `track:${ACTIONS.START}:${tokenAddress}:1` 
            }]
        ]
    };
  }

  async handleCustomThresholdInput(bot, msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userState = stateManager.getUserState(userId);

    if (!userState?.tokenAddress) {
        await bot.sendMessage(chatId, "Session expired. Please run the scan or team command again.");
        return;
    }

    const trackingInfo = stateManager.getTrackingInfo(chatId, userState.tokenAddress);

    const thresholdInput = msg.text.replace('%', '').trim();
    const threshold = parseFloat(thresholdInput);

    if (isNaN(threshold) || threshold < 0.1 || threshold > 100) {
        await bot.sendMessage(chatId, "Invalid input. Please enter a number between 0.1 and 100.");
        return;
    }

    trackingInfo.threshold = threshold;
    trackingInfo.isCustomThreshold = true;  // Ajouter un flag pour le seuil personnalisé
    stateManager.setTrackingInfo(chatId, userState.tokenAddress, trackingInfo);

    await this.updateTrackingMessage(bot, chatId, trackingInfo);
    stateManager.deleteUserState(userId);
}

createThresholdKeyboard(tokenAddress, threshold) {
  const isCustomThreshold = threshold !== 1;
  return {
      inline_keyboard: [
          [
              { 
                  text: !isCustomThreshold ? "✅1%" : "1%",
                  callback_data: `track:${ACTIONS.SET_DEFAULT}:${tokenAddress}:1`
              },
              { 
                  text: isCustomThreshold ? `✅${threshold}%` : "Custom %",
                  callback_data: `track:${ACTIONS.SET_CUSTOM}:${tokenAddress}`
              }
          ],
          [{ 
              text: "Start tracking",
              callback_data: `track:${ACTIONS.START}:${tokenAddress}:${threshold}`
          }]
      ]
  };
}

}

module.exports = TrackingActionHandler;