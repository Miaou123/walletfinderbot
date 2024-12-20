
const ApiCallCounter = require('../utils/ApiCallCounter');
const { scanToken } = require('../analysis/topHoldersScanner');
const { formatScanResult} = require('./formatters/scanResultFormatter');
const {formatTeamSupplyResult, formatWalletDetails} = require('./formatters/teamSupplyFormatter');
const { analyzeTeamSupply } = require('../analysis/teamSupply');
const { getAvailableSpots } = require('../utils/accessSpots');
const SupplyTracker = require('../tools/SupplyTracker');
const UserManager = require('./accessManager/userManager');
const ActiveCommandsTracker = require('./commandsManager/activeCommandsTracker'); 
const { RequestCache, cachedCommand } = require('../utils/requestCache');
const path = require('path');  
const logger = require('../utils/logger');

let lastAnalysisResults = {};
let supplyTrackerInstance;
let pendingTracking = new Map();
let userManager;

const scanCache = new RequestCache(3 * 60 * 1000);
const teamSupplyCache = new RequestCache(2 * 60 * 1000); 

const initializeUserManager = async () => {
  const userFilePath = path.join(__dirname, '../data/all_users.json');
  userManager = new UserManager(userFilePath);
  await userManager.loadUsers();
};

const initializeSupplyTracker = async (bot, accessControlInstance) => {
  supplyTrackerInstance = new SupplyTracker(bot, accessControlInstance);
  try {
    await supplyTrackerInstance.init();
    logger.info('SupplyTracker initialized successfully');
  } catch (error) {
    logger.error('Error initializing SupplyTracker:', error);
    throw error;
  }
};

const handleStartCommand = async (bot, msg, args, messageThreadId) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username;

  if (!userManager) {
    logger.error('UserManager is not initialized. Ensure initializeUserManager is called before using the command.');
    return;
  }

  userManager.addUser(userId, chatId, username);

  const spotsInfo = getAvailableSpots();
  
  if (spotsInfo === null) {
    await bot.sendLongMessage(chatId, "An error occurred while processing your request. Please try again later.", { message_thread_id: messageThreadId });
    return;
  }

  const { availableSpots, maxUsers } = spotsInfo;

  const startMessage = `
Welcome to Noesis! 👁️

For more information on the bot and the current beta phase, please check our <a href="https://smp-team.gitbook.io/noesis-bot">documentation</a> and follow us on <a href="https://x.com/NoesisTracker">twitter</a>.

If you are already whitelisted you can start by using /help for a full list of commands.

If you are not whitelisted yet:

• DM @NoesisTracker on twitter or @rengon0x on Twitter/Telegram to request access.
• Available Spots: ${availableSpots}/${maxUsers}
• Selection Process: Access is granted on a first-come, first-served basis. Inactive users will be removed on a daily basis, and the total number of spots will be increased every week.

📢 Noesis is now available for groups! You can add the bot to your groupchat and use the /scan and /bundle commands without having to be whitelisted. 

If you have any questions, want to report a bug or have any new feature suggestions feel free to dm @Rengon0x on telegram or twitter!

Please note that some commands may take longer to execute than expected. This is primarily due to API restrictions, as we're currently using lower-tier API access. 
As we advance, we intend to upgrade to higher tiers, which will result in 4–10x faster response times.

⚠️This bot is still in development phase and will probably be subject to many bugs/issues⚠️
  `;

  await bot.sendLongMessage(chatId, startMessage, { message_thread_id: messageThreadId });
};

const handlePingCommand = async (bot, msg, args, messageThreadId) => {
  const startTime = Date.now();
  
  await bot.sendLongMessage(msg.chat.id, 'Pinging...', { message_thread_id: messageThreadId });
  
  const endTime = Date.now();
  const latency = endTime - startTime;
  
  await bot.sendLongMessage(msg.chat.id, `Pong! Latency is ${latency}ms`, { message_thread_id: messageThreadId });
};

const handleAccessCommand = async (bot, msg, args, messageThreadId) => {
  const spotsInfo = getAvailableSpots();

  if (spotsInfo === null) {
    await bot.sendLongMessage(msg.chat.id, "An error occurred while processing your request. Please try again later.", { message_thread_id: messageThreadId });
    return;
  }

  const { availableSpots, maxUsers } = spotsInfo;

  const message = `
• Available Spots: ${availableSpots}/${maxUsers}
• How to Join: Please DM @rengon0x on Twitter or Telegram to request access.
• Selection Process: Access is granted on a first-come, first-served basis. Inactive users will be removed on a daily basis, and new spots will be available every week.
  `;

  await bot.sendLongMessage(msg.chat.id, message, { message_thread_id: messageThreadId });
};

const handleScanCommand = async (bot, msg, args, messageThreadId) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username;

  try {
    const [tokenAddress, numberOfHoldersStr] = args;

    // Vérification de l'adresse du token
    if (!tokenAddress) {
      await bot.sendMessage(chatId,
        "Please provide a token address.",
        { message_thread_id: messageThreadId }
      );
      return;
    }

    const numberOfHolders = numberOfHoldersStr ? parseInt(numberOfHoldersStr) : 10;

    if (isNaN(numberOfHolders) || numberOfHolders < 1 || numberOfHolders > 100) {
      await bot.sendLongMessage(chatId, 
        "Invalid number of holders. Please provide a number between 1 and 100.", 
        { message_thread_id: messageThreadId }
      );
      return;
    }

    // Définition de la fonction de récupération si non présent dans le cache
    const fetchScanData = async () => {
      return await scanToken(tokenAddress, numberOfHolders, true, 'scan');
    };

    // On tente de récupérer les données dans le cache
    const scanResult = await cachedCommand(
      scanCache,
      '/scan',
      { tokenAddress, numberOfHolders },
      fetchScanData
    );

    if (!scanResult || !scanResult.scanData) {
      throw new Error("Scan result is incomplete or invalid.");
    }

    // Formater le résultat
    const formattedResult = formatScanResult(
      scanResult.scanData.tokenInfo,
      scanResult.scanData.filteredWallets,
      scanResult.scanData.totalSupplyControlled,
      scanResult.scanData.averagePortfolioValue,
      scanResult.scanData.notableAddresses,
      scanResult.scanData.tokenAddress
    );

    // Envoyer le résultat formaté
    await bot.sendLongMessage(chatId, formattedResult, { 
      parse_mode: 'HTML', 
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Track Supply", callback_data: `track_${tokenAddress}` },
          ]
        ]
      },
      message_thread_id: messageThreadId
    });

    // Sauvegarder les données pour le tracking, si présent
    if (scanResult.trackingInfo) {
      const trackingData = {
        tokenAddress: scanResult.trackingInfo.tokenAddress,
        tokenInfo: {
          symbol: scanResult.trackingInfo.tokenSymbol,
          totalSupply: scanResult.trackingInfo.totalSupply,
          decimals: scanResult.trackingInfo.decimals,
        },
        totalSupplyControlled: scanResult.trackingInfo.totalSupplyControlled,
        initialSupplyPercentage: scanResult.trackingInfo.totalSupplyControlled,
        topHoldersWallets: scanResult.trackingInfo.topHoldersWallets,
        teamWallets: [],
        analysisType: 'tokenScanner',
        trackType: 'topHolders',
        username: username
      };

      // Vérifier que toutes les données sont présentes
      const validationResult = validateTrackingData(trackingData);
      if (!validationResult.isValid) {
        logger.warn(`Invalid tracking data: ${validationResult.message}`);
        throw new Error(`Invalid tracking data: ${validationResult.message}`);
      }

      lastAnalysisResults[chatId] = trackingData;

      logger.debug('Saved tracking data:', {
        chatId,
        tokenAddress,
        savedData: {
          hasTokenInfo: !!trackingData.tokenInfo,
          symbol: trackingData.tokenInfo.symbol,
          totalSupply: trackingData.tokenInfo.totalSupply,
          totalSupplyControlled: trackingData.totalSupplyControlled,
          hasTopHolders: !!trackingData.topHoldersWallets,
          numberOfHolders: trackingData.topHoldersWallets.length
        }
      });
    }
  } catch (error) {
    logger.error('Error in handleScanCommand:', error);
    await bot.sendLongMessage(chatId, 
      `An error occurred during the token scan: ${error.message}`, 
      { message_thread_id: messageThreadId }
    );
  }
};

const handleTeamSupplyCommand = async (bot, msg, args, messageThreadId) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id; 
  const username = msg.from.username;

  try {

    const [tokenAddress] = args;

    if (!tokenAddress) {
      await bot.sendMessage(chatId,
        "Please provide a token address.",
        { message_thread_id: messageThreadId }
      );
      return;
    }

    // Fonction de fetch si pas en cache
    const fetchTeamSupply = async () => {
      return await analyzeTeamSupply(tokenAddress, 'teamSupply');
    };

    const { scanData, trackingInfo } = await cachedCommand(
      teamSupplyCache,
      '/teamSupply',
      { tokenAddress },
      fetchTeamSupply
    );

    logger.debug('Team supply analysis data received:', {
      scanData: {
        hasTokenInfo: !!scanData.tokenInfo,
        hasAnalyzedWallets: !!scanData.analyzedWallets,
        hasTeamWallets: !!scanData.teamWallets,
        totalSupplyControlled: scanData.totalSupplyControlled
      },
      trackingInfo: {
        hasTokenInfo: !!trackingInfo,
        tokenSymbol: trackingInfo?.tokenSymbol,
        totalSupply: trackingInfo?.totalSupply,
        teamWallets: trackingInfo?.teamWallets?.length
      }
    });

    const formattedResult = formatTeamSupplyResult(
      scanData.analyzedWallets,
      scanData.tokenInfo,
      scanData.teamWallets,
      scanData.totalSupplyControlled
    );

    const trackingData = {
      tokenAddress: tokenAddress,
      tokenInfo: {
        symbol: scanData.tokenInfo.symbol,
        totalSupply: scanData.tokenInfo.totalSupply,
        decimals: scanData.tokenInfo.decimals,
      },
      totalSupplyControlled: scanData.totalSupplyControlled,
      initialSupplyPercentage: scanData.totalSupplyControlled,
      teamWallets: scanData.teamWallets,
      topHoldersWallets: [],
      allWalletsDetails: scanData.analyzedWallets,
      analysisType: 'teamSupplyAnalyzer',
      trackType: 'team',
      username
    };

    logger.debug('Team supply tracking data prepared:', {
      tokenAddress,
      symbol: trackingData.tokenInfo.symbol,
      totalSupply: trackingData.tokenInfo.totalSupply,
      teamWalletsCount: trackingData.teamWallets.length,
      totalSupplyControlled: trackingData.totalSupplyControlled
    });

    lastAnalysisResults[chatId] = trackingData;

    logger.debug('Team supply data saved in lastAnalysisResults:', {
      chatId,
      hasTrackingData: !!lastAnalysisResults[chatId],
      savedData: {
        hasTokenInfo: !!lastAnalysisResults[chatId]?.tokenInfo,
        hasTeamWallets: !!lastAnalysisResults[chatId]?.teamWallets,
        trackType: lastAnalysisResults[chatId]?.trackType
      }
    });

    await bot.sendLongMessage(chatId, formattedResult, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Track Team Wallets", callback_data: `track_${tokenAddress}_team` },
            { text: "Show Team Wallets Details", callback_data: `details_${tokenAddress}` }
          ]
        ]
      },
      disable_web_page_preview: true,
      message_thread_id: messageThreadId
    });

  } catch (error) {
    logger.error('Error in handleTeamSupplyCommand:', error);
    await bot.sendLongMessage(chatId, 
      `An error occurred during team supply analysis: ${error.message}`, 
      { message_thread_id: messageThreadId }
    );
  } finally {
    logger.debug('handleTeamSupplyCommand completed');
  }
};

const handleTrackerCommand = async (bot, msg, args, messageThreadId) => {
  logger.info(`Starting Tracker command for user ${msg.from.username}`);
  const chatId = msg.chat.id;
  const username = msg.from.username;

  const trackedSupplies = supplyTrackerInstance.getTrackedSuppliesByUser(username);
  console.log("Tracked supplies:", trackedSupplies);

  if (trackedSupplies.length === 0) {
    await bot.sendLongMessage(chatId, "You are not currently tracking any supplies. To start tracking supplies, please run /team or /scan first.", { message_thread_id: messageThreadId });
    return;
  }

  let message = `<b>Your currently tracked supplies:</b>\n\n`;
  const inlineKeyboard = [];

  trackedSupplies.forEach((supply, index) => {
    let { ticker, tokenAddress, trackType, currentSupplyPercentage, significantChangeThreshold } = supply;

    currentSupplyPercentage = currentSupplyPercentage ? parseFloat(currentSupplyPercentage) : null;
    
    significantChangeThreshold = significantChangeThreshold ? parseFloat(significantChangeThreshold) : 'N/A';

    const typeEmoji = trackType === 'topHolders' ? '🥇' : '👥';

    let supplyEmoji = '☠️';
    if (currentSupplyPercentage !== null) {
      if (currentSupplyPercentage <= 10) supplyEmoji = '🟢';
      else if (currentSupplyPercentage <= 20) supplyEmoji = '🟡';
      else if (currentSupplyPercentage <= 40) supplyEmoji = '🟠';
      else if (currentSupplyPercentage <= 50) supplyEmoji = '🔴';
    }

    const formattedSupply = currentSupplyPercentage !== null ? currentSupplyPercentage.toFixed(2) : 'N/A';

    message += `${index + 1}. <b>${ticker}</b> <a href="https://dexscreener.com/solana/${tokenAddress}">📈</a>\n`;
    message += `   Tracking type: ${trackType} ${typeEmoji}\n`;
    message += `   Supply: ${formattedSupply}% ${supplyEmoji}\n`;
    message += `   Threshold: ${significantChangeThreshold}%\n\n`;

    inlineKeyboard.push([{
      text: `Stop tracking ${ticker}`,
      callback_data: `stop_${tokenAddress}_${trackType}`
    }]);
  });

  await bot.sendLongMessage(chatId, message, {
    reply_markup: {
      inline_keyboard: inlineKeyboard
    },
    parse_mode: 'HTML',
    message_thread_id: messageThreadId
  });
};


const handleStopCommand = async (bot, msg, args, messageThreadId) => {
  const chatId = msg.chat.id;
  const username = msg.from.username;
  const [trackerId] = args;

  try {
    const success = supplyTrackerInstance.stopTracking(username, trackerId);
    if (success) {
      await bot.sendLongMessage(chatId, `Tracking stopped for ${trackerId}`, { message_thread_id: messageThreadId });
    } else {
      await bot.sendLongMessage(chatId, `No active tracking found for ${trackerId}`, { message_thread_id: messageThreadId });
    }
  } catch (error) {
    logger.error(`Error stopping tracking: ${error.message}`);
    await bot.sendLongMessage(chatId, "An error occurred while stopping the tracking.", { message_thread_id: messageThreadId });
  }
};

const userStates = new Map();

const handleCallbackQuery = async (bot, callbackQuery) => {
  const action = callbackQuery.data;
  const chatId = callbackQuery.message.chat.id;
  const username = callbackQuery.from.username;
  const messageThreadId = callbackQuery.message.message_thread_id;

  try {
    const [actionType, ...params] = action.split('_');
    // Déclarer les variables une seule fois
    const tokenAddress = params[0];
    let threshold;
    let trackType = params[1] || 'topHolders';

    logger.debug(`Callback query: actionType=${actionType}, params=${params}`);

    // Ne mettre dans le premier switch que ce qui doit modifier les valeurs
    switch (actionType) {
      case 'st':
        threshold = parseFloat(params[1]);
        break;
    }

    logger.debug(`Processed callback data: actionType=${actionType}, tokenAddress=${tokenAddress}, threshold=${threshold}, trackType=${trackType}`);

    const trackingId = `${chatId}_${tokenAddress}`;
    let trackingInfo = pendingTracking.get(trackingId) || lastAnalysisResults[chatId];

    if (trackingInfo && trackingInfo.tokenAddress !== tokenAddress) {
      logger.warn(`Mismatch in token addresses. Callback: ${tokenAddress}, Tracking: ${trackingInfo.tokenAddress}`);
      trackingInfo = null; 
    }

    switch (actionType) {
      case 'track':
        if (!trackingInfo) {
          await bot.answerCallbackQuery(callbackQuery.id, { 
            text: "Tracking information is outdated. Please run the scan again.", 
            show_alert: true 
          });
          return;
        }
        trackingInfo.trackType = trackType;
        return await handleTrackAction(bot, chatId, tokenAddress, trackingInfo, messageThreadId);

        case 'details':
          if (!trackingInfo || !trackingInfo.allWalletsDetails || !trackingInfo.tokenInfo) {
            throw new Error("No wallet details or token information found. Please run the analysis again.");
          }
          const message = formatWalletDetails(trackingInfo.allWalletsDetails, trackingInfo.tokenInfo);
          await bot.sendLongMessage(chatId, message, {
            parse_mode: 'HTML',
            message_thread_id: messageThreadId
          });
          break;

      case 'sd':
        await handleSetDefaultThreshold(bot, chatId, trackingInfo, trackingId, messageThreadId);
        break;

      case 'sc':
        await handleSetCustomThreshold(bot, chatId, trackingInfo, trackingId, messageThreadId);
        break;

      case 'st':
        if (!trackingInfo) {
          await bot.answerCallbackQuery(callbackQuery.id, { 
            text: "Tracking information is outdated. Please run the scan again.", 
            show_alert: true 
          });
          return;
        }
        await handleStartTracking(bot, chatId, trackingInfo, threshold, messageThreadId);
        break;

      case 'stop':
        const trackerId = `${tokenAddress}_${trackType}`;
        logger.debug(`Stopping tracking for: ${trackerId}, username: ${username}`);
        
        const success = supplyTrackerInstance.stopTracking(username, trackerId);
        if (success) {
          await bot.answerCallbackQuery(callbackQuery.id, { text: "Tracking stopped successfully." });
          await bot.editMessageText("Tracking stopped. Use /tracker to see your current trackers.", {
            chat_id: chatId,
            message_id: callbackQuery.message.message_id,
            message_thread_id: messageThreadId
          });
        } else {
          await bot.answerCallbackQuery(callbackQuery.id, { text: "Failed to stop tracking. Tracker not found." });
        }
        break;

      default:
        throw new Error(`Unknown action type: ${actionType}`);
    }

    if (!callbackQuery.answered) {
      await bot.answerCallbackQuery(callbackQuery.id);
    }
  } catch (error) {
    logger.error('Error in handleCallbackQuery:', error);
    const errorMessage = `An error occurred: ${error.message}. Please try again or contact support.`;
    await bot.sendLongMessage(chatId, errorMessage, { message_thread_id: messageThreadId });
    if (!callbackQuery.answered) {
      await bot.answerCallbackQuery(callbackQuery.id, { text: "An error occurred", show_alert: true });
    }
  }
};

const handleTrackAction = async (bot, chatId, tokenAddress, trackingInfo, messageThreadId) => {
  logger.debug(`Starting handleTrackAction for token: ${tokenAddress}, chatId: ${chatId}`);
  logger.debug(`Current trackingInfo:`, trackingInfo);

  try {
      if (!trackingInfo || !trackingInfo.tokenInfo || trackingInfo.tokenAddress !== tokenAddress) {
          logger.error(`Mismatch in token addresses. Received: ${tokenAddress}, Expected: ${trackingInfo ? trackingInfo.tokenAddress : 'undefined'}`);
          throw new Error('Invalid or outdated tracking info');
      }

      // Définir trackType avant de l'utiliser
      const trackType = trackingInfo.trackType || 
                       (trackingInfo.analysisType === 'tokenScanner' ? 'topHolders' : 'team');

      logger.debug(`Track type determined: ${trackType}`);

      const totalSupply = trackingInfo.tokenInfo.totalSupply;
      const decimals = trackingInfo.tokenInfo.decimals || 6;
      const ticker = trackingInfo.tokenInfo.symbol || 'Unknown';
      const initialSupplyPercentage = trackingInfo.totalSupplyControlled || trackingInfo.initialSupplyPercentage || 0;
      const username = trackingInfo.username;
      const supplyType = trackType === 'team' ? 'team supply' : 'total supply';

      logger.debug('Extracted info:', { totalSupply, decimals, ticker, initialSupplyPercentage, trackType, username });

      if (!totalSupply || isNaN(initialSupplyPercentage)) {
          throw new Error('Invalid supply information');
      }

      const message = `🔁 Ready to track ${ticker} ${supplyType} (${initialSupplyPercentage.toFixed(2)}%)\n\n` +
                     `You will receive a notification when ${supplyType} changes by more than 1%`;

      const keyboard = {
          inline_keyboard: [
              [
                  { text: "✅1%", callback_data: `sd_${tokenAddress}_1` },
                  { text: "Custom %", callback_data: `sc_${tokenAddress}` }
              ],
              [{ text: "Start tracking", callback_data: `st_${tokenAddress}_1` }]
          ]
      };

      const sentMessage = await bot.sendMessage(chatId, message, { 
          reply_markup: keyboard, 
          parse_mode: 'HTML',
          message_thread_id: messageThreadId
      });

      trackingInfo.messageId = sentMessage.message_id;
      trackingInfo.trackType = trackType; // Sauvegarder le trackType dans trackingInfo

      lastAnalysisResults[chatId] = trackingInfo;
      const trackingId = `${chatId}_${tokenAddress}`;
      pendingTracking.set(trackingId, trackingInfo);

      logger.info(`Track action message sent successfully for ${ticker} ${trackType}`);
  } catch (error) {
      logger.error('Error in handleTrackAction:', error);
      try {
          await bot.sendMessage(chatId, `An error occurred while setting up tracking: ${error.message}. Please try again or contact support.`, { 
              message_thread_id: messageThreadId 
          });
      } catch (sendError) {
          logger.error('Error sending error message to user:', sendError);
      }
  }
};

const handleSetDefaultThreshold = async (bot, chatId, trackingInfo, trackingId, messageThreadId) => {
  trackingInfo.threshold = 1;
  pendingTracking.set(trackingId, trackingInfo);
  await updateTrackingMessage(bot, chatId, trackingInfo, trackingId, messageThreadId);
};

const updateTrackingMessage = async (bot, chatId, trackingInfo, trackingId, messageThreadId) => {
  const tokenAddress = trackingInfo.tokenAddress;
  const threshold = trackingInfo.threshold || 1;
  const ticker = trackingInfo.tokenInfo.symbol || 'Unknown';
  const initialSupplyPercentage = trackingInfo.totalSupplyControlled || trackingInfo.initialSupplyPercentage || 0;
  const trackType = trackingInfo.trackType || (trackingInfo.analysisType === 'tokenScanner' ? 'topHolders' : 'team');
  const supplyType = trackType === 'team' ? 'team supply' : 'total supply';

  const message = `🔁 Ready to track ${ticker} ${supplyType} (${initialSupplyPercentage.toFixed(2)}%)\n\n` +
                  `You will receive a notification when ${supplyType} changes by more than ${threshold}%`;

  const isDefaultThreshold = threshold === 1;

  const keyboard = {
    inline_keyboard: [
      [
        { text: isDefaultThreshold ? "✅1%" : "1%", callback_data: `sd_${tokenAddress}_1` },
        { text: !isDefaultThreshold ? `✅${threshold}%` : "Custom %", callback_data: `sc_${tokenAddress}` }
      ],
      [{ text: "Start tracking", callback_data: `st_${tokenAddress}_${threshold}` }]
    ]
  };

  try {
    await bot.editMessageText(message, {
      chat_id: chatId,
      message_id: trackingInfo.messageId,
      reply_markup: keyboard,
      message_thread_id: messageThreadId
    });
  } catch (error) {
    logger.error('Error updating tracking message:', error);
  }
};

const handleSetCustomThreshold = async (bot, chatId, trackingInfo, trackingId, messageThreadId) => {
  await bot.sendLongMessage(chatId, "Enter new supply change percentage (e.g., 2.5):", { message_thread_id: messageThreadId });
  trackingInfo.awaitingCustomThreshold = true;
  pendingTracking.set(trackingId, trackingInfo);

  userStates.set(chatId, {
    action: 'awaiting_custom_threshold',
    trackingId: trackingId
  });
};

const handleStartTracking = async (bot, chatId, trackingInfo, threshold, messageThreadId) => {
  threshold = trackingInfo.threshold || threshold || 1;
  const { tokenAddress, teamWallets, topHoldersWallets, initialSupplyPercentage, tokenInfo, username, analysisType } = trackingInfo;
  const trackType = trackingInfo.trackType || (trackingInfo.analysisType === 'tokenScanner' ? 'topHolders' : 'team');
  const totalSupply = tokenInfo.totalSupply;

  logger.debug(`Starting tracking for ${tokenAddress}`, { trackingInfo });

  const wallets = trackType === 'team' ? teamWallets : topHoldersWallets;

  if (!wallets || wallets.length === 0) {
    logger.warn(`No ${trackType} wallets found for ${tokenAddress}. This may cause issues with tracking.`);
    await bot.sendLongMessage(chatId, `Warning: No ${trackType} wallets found. Tracking may not work as expected.`, { message_thread_id: messageThreadId });
    return;
  }

  try {
    supplyTrackerInstance.startTracking(
      tokenAddress,
      chatId,
      wallets,
      initialSupplyPercentage,
      totalSupply,
      threshold,
      tokenInfo.symbol,
      tokenInfo.decimals,
      trackType,
      username
    );

    await bot.sendLongMessage(chatId, `Tracking started for ${tokenInfo.symbol} ${trackType} supply with ${threshold}% threshold. Use /tracker to see and manage your active trackings.`, { message_thread_id: messageThreadId });
    logger.info('SupplyTracker.startTracking called successfully');
  } catch (error) {
    logger.error("Error starting tracking:", error);
    await bot.sendLongMessage(chatId, `An error occurred while starting the tracking: ${error.message}`, { message_thread_id: messageThreadId });
  }
};

const handleMessage = async (bot, msg) => {
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const userState = userStates.get(chatId);
  const messageThreadId = msg.message_thread_id;

  if (userState && userState.action === 'awaiting_custom_threshold') {
    const trackingId = userState.trackingId;
    let trackingInfo = pendingTracking.get(trackingId);

    if (!trackingInfo) {
      await bot.sendLongMessage(chatId, "Tracking info not found. Please start over.", { message_thread_id: messageThreadId });
      userStates.delete(chatId);
      return;
    }

    const thresholdInput = text.replace('%', '').trim();
    const threshold = parseFloat(thresholdInput);

    if (isNaN(threshold) || threshold < 0.1 || threshold > 100) {
      await bot.sendLongMessage(chatId, "Invalid input. Please enter a number between 0.1 and 100 for the threshold.", { message_thread_id: messageThreadId });
      return;
    }

    trackingInfo.threshold = threshold;
    trackingInfo.awaitingCustomThreshold = false;
    pendingTracking.set(trackingId, trackingInfo);

    await updateTrackingMessage(bot, chatId, trackingInfo, trackingId, messageThreadId);
    userStates.delete(chatId);
  } else {
    // Gérer d'autres messages ou ignorer
  }
};

// Fonction utilitaire pour valider les données de tracking
function validateTrackingData(data) {
  const requiredFields = {
    tokenAddress: data.tokenAddress,
    'tokenInfo.symbol': data.tokenInfo?.symbol,
    'tokenInfo.totalSupply': data.tokenInfo?.totalSupply,
    'tokenInfo.decimals': data.tokenInfo?.decimals,
    totalSupplyControlled: data.totalSupplyControlled,
    topHoldersWallets: data.topHoldersWallets
  };

  const missingFields = Object.entries(requiredFields)
    .filter(([_, value]) => value === undefined || value === null)
    .map(([key]) => key);

  return {
    isValid: missingFields.length === 0,
    message: missingFields.length > 0 ? `Missing required fields: ${missingFields.join(', ')}` : ''
  };
}

// Export all command handlers
module.exports = {
  start: handleStartCommand,
  ping: handlePingCommand,
  scan: handleScanCommand,
  s: handleScanCommand,
  team: handleTeamSupplyCommand,
  t: handleTeamSupplyCommand,
  tracker: handleTrackerCommand,
  tr: handleTrackerCommand,
  stop: handleStopCommand,
  initializeSupplyTracker,
  handleCallbackQuery,
  handleMessage,
  initializeUserManager, 
  access: handleAccessCommand,
  join: handleAccessCommand,
};

Object.keys(module.exports).forEach(key => {
  if (typeof module.exports[key] === 'function' && !['initializeSupplyTracker', 'handleCallbackQuery', 'handleMessage', 'initializeUserManager'].includes(key)) {
    const originalHandler = module.exports[key];
    module.exports[key] = async (bot, msg, args) => {
      const messageThreadId = msg.message_thread_id;
      return await originalHandler(bot, msg, args, messageThreadId);
    };
  }
});

const originalHandleCallbackQuery = module.exports.handleCallbackQuery;
module.exports.handleCallbackQuery = async (bot, callbackQuery) => {
  const messageThreadId = callbackQuery.message.message_thread_id;
  return await originalHandleCallbackQuery(bot, callbackQuery, messageThreadId);
};

const originalHandleMessage = module.exports.handleMessage;
module.exports.handleMessage = async (bot, msg) => {
  const messageThreadId = msg.message_thread_id;
  return await originalHandleMessage(bot, msg, messageThreadId);
};