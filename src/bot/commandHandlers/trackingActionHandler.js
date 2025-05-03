// handlers/trackingActionHandler.js
const logger = require('../../utils/logger');
const stateManager = require('../../utils/stateManager');
// Import formatters for different track types
const { formatWalletDetails: formatTeamWalletDetails } = require('../formatters/teamSupplyFormatter');
const { formatWalletDetails: formatFreshWalletDetails } = require('../formatters/freshWalletFormatter');

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
        // First check if this is a tracking setup cancellation (no active tracker)
        const activeTrackers = this.supplyTracker.getTrackedSuppliesByUser(chatId);
        const hasActiveTracker = activeTrackers.some(t => t.tokenAddress === tokenAddress);
        
        if (!hasActiveTracker) {
          logger.debug('Canceling tracking setup process (no active tracker)', {
            chatId,
            tokenAddress
          });
          
          // Clean up any potential custom threshold states
          const groupKey = `grp_${chatId}`;
          stateManager.deleteUserState(groupKey);
          
          // If enhanced stateManager is available, do a comprehensive cleanup
          // Here we want to preserve tracking info since we're just canceling the setup
          if (typeof stateManager.cleanAllChatStates === 'function') {
            stateManager.cleanAllChatStates(chatId, { preserveTrackingInfo: true });
          } else {
            this.cleanupAllInputStates?.(chatId);
          }
          
          // Update the message to show cancellation
          try {
            await bot.editMessageText(
              "Tracking setup canceled.", 
              {
                chat_id: chatId,
                message_id: query.message.message_id
              }
            );
          } catch (error) {
            logger.error('Error updating message for cancellation:', error);
            // Try to send a new message if editing fails
            await bot.sendMessage(chatId, "Tracking setup canceled.");
          }
          
          await bot.answerCallbackQuery(query.id, { 
            text: "Tracking setup canceled." 
          });
          return;
        }
        
        // Otherwise, this is a normal tracking stop action
        await this.executeAction(action, bot, query, { tokenAddress });
        return;
      }

      // Initial tracking from scan, team or fresh
      if (action === 'supply' || action === 'team' || action === 'fresh') {
          // Determine track type based on action
          let trackType;
          if (action === 'team') {
              trackType = 'team';
          } else if (action === 'fresh') {
              trackType = 'fresh';
          } else {
              trackType = 'topHolders';
          }
          
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
   
   let message;
   // Use the appropriate formatter based on track type
   if (trackingInfo.trackType === 'fresh') {
     message = formatFreshWalletDetails(trackingInfo.allWalletsDetails, trackingInfo.tokenInfo);
   } else {
     // Default to team wallet formatter for other types
     message = formatTeamWalletDetails(trackingInfo.allWalletsDetails, trackingInfo.tokenInfo);
   }
   
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
        
        // Clean up any lingering states to prevent further processing
        this.cleanupAllInputStates(chatId, userId);
        return;
    }

    // Parse and validate the threshold input
    const thresholdInput = msg.text.replace('%', '').trim();
    const threshold = parseFloat(thresholdInput);

    if (isNaN(threshold) || threshold < 0.1 || threshold > 100) {
        logger.debug('Invalid threshold value:', thresholdInput);
        await bot.sendMessage(chatId, "Invalid input. Please enter a number between 0.1 and 100.");
        
        // Important: Clean up all states even for invalid input to stop listening
        this.cleanupAllInputStates(chatId, userId);
        return;
    }

    // Get tracking info using the token address from state
    const trackingInfo = stateManager.getTrackingInfo(chatId, userState.tokenAddress);
    if (!trackingInfo) {
        logger.debug('No tracking info found for token:', userState.tokenAddress);
        await bot.sendMessage(chatId, "Tracking information expired. Please run the scan command again.");
        
        // Clean up all states
        this.cleanupAllInputStates(chatId, userId);
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
    
    // Clean up all states thoroughly to stop listening for further input
    this.cleanupAllInputStates(chatId, userId);
    
    logger.debug('Threshold updated successfully:', {
      newThreshold: threshold,
      tokenAddress: trackingInfo.tokenAddress
    });
  }
  
  // Helper method to thoroughly clean up all input-related states
  // But preserve the tracking info for the token
  cleanupAllInputStates(chatId, userId) {
    logger.debug('Cleaning up input states while preserving tracking info', { chatId, userId });
    
    // Only clean up user states related to awaiting input
    // Don't clean up tracking info, which is needed for the custom % button
    
    // Clean up group state for input handling
    const groupStateKey = `grp_${chatId}`;
    const groupState = stateManager.getUserState(groupStateKey);
    if (groupState && groupState.action === 'awaiting_custom_threshold') {
      logger.debug('Deleting group awaiting_custom_threshold state', { groupStateKey });
      stateManager.deleteUserState(groupStateKey);
    }
    
    // Clean up user state
    if (userId) {
      const userState = stateManager.getUserState(userId);
      if (userState && userState.action === 'awaiting_custom_threshold') {
        logger.debug('Deleting user awaiting_custom_threshold state', { userId });
        stateManager.deleteUserState(userId);
      }
    }
    
    // Try to clean up all users in this group with awaiting_custom_threshold state
    for (const [key, state] of stateManager.userStates.entries()) {
      if (state?.action === 'awaiting_custom_threshold') {
        logger.debug('Deleting related awaiting_custom_threshold state', { key });
        stateManager.deleteUserState(key);
      }
    }
    
    logger.debug('Completed cleaning input states while preserving tracking info');
  }

 async handleStartTracking(bot, chatId, trackingInfo, threshold) {
   const { tokenAddress, teamWallets, freshWallets, topHoldersWallets, wallets: directWallets, tokenInfo } = trackingInfo;
   const trackType = trackingInfo.trackType || 'topHolders';
   
   // First check if there are direct wallets provided (from wallets field)
   let wallets = directWallets;
   
   // If not, check for the specific wallet type based on trackType
   if (!wallets || !wallets.length) {
     if (trackType === 'team') {
       wallets = teamWallets;
     } else if (trackType === 'fresh') {
       wallets = freshWallets?.map(w => w.address || w);
     } else {
       wallets = topHoldersWallets;
     }
   }
   
   // Log what we found for debugging
   logger.debug(`Starting tracking with wallets:`, {
     trackType,
     hasDirectWallets: !!directWallets?.length,
     hasTeamWallets: !!teamWallets?.length,
     hasFreshWallets: !!freshWallets?.length,
     wallets: wallets?.slice(0, 3) // Log just a few for brevity
   });

   if (!wallets?.length) {
     return await bot.sendMessage(chatId, 
       `Warning: No ${trackType} wallets found. Tracking may not work as expected.`
     );
   }

   try {
     // First, clean up any lingering threshold input states to prevent errors
     logger.debug('Cleaning up states before starting tracking', {
       chatId, tokenAddress, trackType
     });
     
     // Clean up group threshold state
     const groupKey = `grp_${chatId}`;
     stateManager.deleteUserState(groupKey);
     
     // Clean up linked user states if possible
     if (typeof stateManager.cleanAllChatStates === 'function') {
       // When starting tracking, we DO want to clean up everything
       // including tracking data, as the supplyTracker will manage the tracking now
       stateManager.cleanAllChatStates(chatId, { preserveTrackingInfo: false });
     } else if (typeof this.cleanupAllChatStates === 'function') {
       this.cleanupAllChatStates(chatId);
     }
     
     // Start tracking
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

     // Force reset of user states
     try {
       // Find and clean up any user states related to this tracking
       if (typeof stateManager.getAllKeys === 'function') {
         const allUserKeys = stateManager.getAllKeys().userStates || [];
         for (const key of allUserKeys) {
           const state = stateManager.getUserState(key);
           if (state?.tokenAddress === tokenAddress || 
               state?.action === 'awaiting_custom_threshold') {
             logger.debug(`Cleaning up user state for ${key} after tracking start`);
             stateManager.deleteUserState(key);
           }
         }
       }
     } catch (error) {
       logger.error('Error cleaning up user states after tracking start:', error);
     }

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
   // Determine the appropriate supply type description
   let supplyTypeDesc;
   if (trackingInfo.trackType === 'fresh') {
     supplyTypeDesc = 'fresh wallet supply';
   } else if (trackingInfo.trackType === 'team') {
     supplyTypeDesc = 'team supply';
   } else {
     supplyTypeDesc = 'total supply';
   }
   
   const baseMessage = `🔁 Ready to track ${trackingInfo.tokenInfo.symbol} ${supplyTypeDesc} ` +
                      `(${trackingInfo.totalSupplyControlled.toFixed(2)}%)\n\n`;
                      
   return baseMessage + `You will receive a notification when ${supplyTypeDesc} changes by more than ${threshold}%`;
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
            [
                { 
                    text: "Start tracking", 
                    callback_data: `track:${ACTIONS.START}:${tokenAddress}:1` 
                },
                {
                    text: "❌ Cancel",
                    callback_data: `track:${ACTIONS.STOP}:${tokenAddress}:1`
                }
            ]
        ]
    };
  }

  // NOTE: This is a duplicate method that is not being used
  // The main implementation is above at line ~293

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
          [
              { 
                  text: "Start tracking",
                  callback_data: `track:${ACTIONS.START}:${tokenAddress}:${threshold}`
              },
              {
                  text: "❌ Cancel",
                  callback_data: `track:${ACTIONS.STOP}:${tokenAddress}:${threshold}`
              }
          ]
      ]
  };
}

}

module.exports = TrackingActionHandler;