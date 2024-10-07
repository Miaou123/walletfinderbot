const dexScreenerApi = require('../integrations/dexScreenerApi');
const ApiCallCounter = require('../utils/ApiCallCounter');
const { formatEarlyBuyersMessage } = require('./formatters/earlyBuyersFormatter');
const { analyzeEarlyBuyers } = require('../analysis/earlyBuyers');
const { crossAnalyze } = require('../analysis/crossAnalyzer');
const { sendFormattedCrossAnalysisMessage } = require('./formatters/crossAnalysisFormatter');
const { formatBestTraders } = require('./formatters/bestTradersFormatter');
const { scanToken } = require('../analysis/topHoldersScanner');
const { formatAnalysisMessage, getHoldingEmoji} = require('./formatters/walletAnalyzerFormatter');
const { analyzeToken } = require('../analysis/topHoldersAnalyzer');
const { searchWallets } = require('../analysis/walletSearcher');
const { analyzeBestTraders } = require('../analysis/bestTraders');
const { analyzeTeamSupply, sendWalletDetails } = require('../analysis/teamSupply');
const BundleFinder = require('../analysis/bundleFinder');
const { formatBundleResponse } = require('./formatters/bundleFormatter');
const SupplyTracker = require('../tools/SupplyTracker');

let pendingTracking = new Map();
let lastAnalysisResults = {};
let supplyTrackerInstance;

const initializeSupplyTracker = (bot, accessControlInstance) => {
  supplyTrackerInstance = new SupplyTracker(bot, accessControlInstance);
};

const handleStartCommand  = (bot, msg, args) => {
  const newLocal = `
Welcome to Noesis! ✨🔍
  
For more information on the bot and the current beta phase, please check our <a href="https://smp-team.gitbook.io/noesis-bot">documentation</a>.

If you are already whitelisted you can start by using /help for a full list of commands.
  
If you have any questions, want to report a bug or have any new feature suggestions feel free to dm @Rengon0x on telegram or twitter!

Please note that some commands may take longer to execute than expected. This is primarily due to API restrictions, as we're currently using lower-tier API access. 
As we advance, we intend to upgrade to higher tiers, which will result in 4–10x faster response times.
  
⚠️This bot is still in development phase and will probably be subject to many bugs/issues⚠️
  `;
const startMessage = newLocal;

bot.sendLongMessage(msg.chat.id, startMessage);
};
  

const handlePingCommand = async (bot, msg, args) => {
  const startTime = Date.now();
  const message = await bot.sendLongMessage(msg.chat.id, 'Pinging...');
  const endTime = Date.now();
  const latency = endTime - startTime;
  await bot.editMessageText(`Pong! Latency is ${latency}ms`, {
    chat_id: msg.chat.id,
    message_id: message.message_id
  });
};

const handleScanCommand = async (bot, msg, args) => {
  try {
    const [tokenAddress, numberOfHoldersStr] = args;
    const numberOfHolders = numberOfHoldersStr ? parseInt(numberOfHoldersStr) : 10;

    // Validation du nombre de détenteurs
    if (isNaN(numberOfHolders) || numberOfHolders < 1 || numberOfHolders > 100) {
      await bot.sendLongMessage(msg.chat.id, "Invalid number of holders. Please provide a number between 1 and 100.");
      return;
    }

    await bot.sendLongMessage(msg.chat.id, `Starting scan for token: ${tokenAddress}\nAnalyzing top ${numberOfHolders} holders. This may take a few minutes...`);

    const scanResult = await scanToken(tokenAddress, numberOfHolders, true, 'scan');
    // Envoyer le résultat formaté
    await bot.sendLongMessage(msg.chat.id, scanResult.formattedResult, { 
      parse_mode: 'HTML', 
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Track Supply", callback_data: `track_total_${tokenAddress}` },
          ]
        ]
      }
    });

    // Harmoniser lastAnalysisResults
    lastAnalysisResults[msg.chat.id] = {
      tokenAddress: scanResult.trackingInfo.tokenAddress,
      tokenInfo: {
        symbol: scanResult.trackingInfo.tokenSymbol,
        totalSupply: scanResult.trackingInfo.totalSupply,
        decimals: scanResult.trackingInfo.decimals,
      },
      totalSupplyControlled: scanResult.trackingInfo.totalSupplyControlled,
      initialSupplyPercentage: scanResult.trackingInfo.totalSupplyControlled,
      topHoldersWallets: scanResult.trackingInfo.topHoldersWallets,
      teamWallets: [], // Vide pour la commande scan
      allWalletsDetails: scanResult.allAnalyzedWallets,
      analysisType: 'tokenScanner',
      trackType: 'topHolders',
      username: msg.from.username,
    };

  } catch (error) {
    console.error('Error in handleScanCommand:', error);
    await bot.sendLongMessage(msg.chat.id, `An error occurred during the token scan: ${error.message}`);
  } finally {
    ApiCallCounter.logApiCalls('scan');
  }
};

const handleTopHoldersCommand = async (bot, msg, args) => {
  try {
    const [coinAddress, topHoldersCountStr] = args;
    const count = parseInt(topHoldersCountStr) || 20;

    if (isNaN(count) || count < 1 || count > 100) {
      await bot.sendLongMessage(msg.chat.id, "Invalid number of holders. Please provide a number between 1 and 100.");
      return;
    }

    console.log(`User requested ${count} top holders`);

    await bot.sendLongMessage(msg.chat.id, `Starting top holders analysis for coin: ${coinAddress}\nThis may take a few minutes...`);
    
    // Effectuer l'analyse
    const { tokenInfo, analyzedWallets } = await analyzeToken(coinAddress, count, 'Analyze');
    
    // Vérifiez que analyzedWallets n'est pas vide
    if (analyzedWallets.length === 0) {
      await bot.sendLongMessage(msg.chat.id, "No wallets found for analysis.");
      return;
    }

    const { messages, errors } = formatAnalysisMessage(analyzedWallets, tokenInfo);

    for (const message of messages) {
        if (typeof message === 'string' && message.trim() !== '') {
            await bot.sendLongMessage(msg.chat.id, message, {
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });
        }
    }

    if (errors.length > 0) {
      console.error('Errors encountered during analysis:');
      errors.forEach(error => console.error(error));
      await bot.sendLongMessage(msg.chat.id, "Some errors occurred during analysis. Please check the logs for more details.");
    }

  } catch (error) {
    console.error(`Error in handleTopHoldersCommand:`, error);
    await bot.sendLongMessage(msg.chat.id, `An error occurred during analysis: ${error.message}`);
  } finally {
    ApiCallCounter.logApiCalls('Analyze');
  }

};

const handleEarlyBuyersCommand = async (bot, msg, args) => {
  try {
    const [coinAddress, timeFrame, percentage] = args;

    // Validation du time frame
    const hours = validateAndParseTimeFrame(timeFrame);
    if (hours === null) {
      await bot.sendLongMessage(msg.chat.id, "Invalid time frame. Please enter a number between 0.25 and 5 hours, or 15 and 300 minutes.");
      return;
    }

    const tokenInfo = await dexScreenerApi.getTokenInfo(coinAddress);
    
    if (!tokenInfo) {
      throw new Error("Failed to fetch token information");
    }
    console.log("Token info fetched:", tokenInfo);

    // Validate and parse percentage
    const { minPercentage } = validateAndParseMinAmountOrPercentage(percentage, tokenInfo.totalSupply, tokenInfo.decimals);

    console.log(`Parsed time frame into hours: ${hours}, Min percentage: ${minPercentage}%`);

    await bot.sendLongMessage(
      msg.chat.id,
      `🔎 Analyzing early buyers for <b>${tokenInfo.symbol}</b>\n` +
      `⏳ Time frame: <b>${hours} hours</b>\n` +
      `📊 Minimum percentage: <b>${minPercentage}%</b>`,
      { parse_mode: 'HTML', disable_web_page_preview: true }
    );      

    console.log(`Starting early buyers analysis for ${coinAddress}`);
    const result = await analyzeEarlyBuyers(coinAddress, minPercentage, hours, tokenInfo, 'earlyBuyers');

    if (!result || !result.earlyBuyers) {
      throw new Error("Invalid result from analyzeEarlyBuyers");
    }

    let formattedMessage = formatEarlyBuyersMessage(result.earlyBuyers, tokenInfo, hours, coinAddress);
    if (!formattedMessage || formattedMessage.length === 0) {
      formattedMessage = "No early buyers found or error in formatting the message.";
    }

    const sentMessage = await bot.sendLongMessage(msg.chat.id, formattedMessage, { parse_mode: 'HTML', disable_web_page_preview: true });

  } catch (error) {
    console.error(`Error in handleEarlyBuyersCommand:`, error);
    let errorMessage = `An error occurred during early buyers analysis: ${error.message}.`;
    if (error.stack) {
      console.error("Error stack:", error.stack);
    }
    await bot.sendLongMessage(msg.chat.id, errorMessage);
  } finally {
    ApiCallCounter.logApiCalls('earlyBuyers');
  }

};

const validateAndParseTimeFrame = (timeFrame) => {
  if (!timeFrame) return 1; // Default to 1 hour if no input

  // Check if the input ends with 'm' or 'min' for minutes
  if (typeof timeFrame === 'string' && (timeFrame.endsWith('m') || timeFrame.endsWith('min'))) {
    const minutes = parseFloat(timeFrame.replace(/[m|min]/, ''));
    if (isNaN(minutes) || minutes < 15 || minutes > 300) { // 300 minutes = 5 hours
      throw new Error("Invalid time frame. Please enter a number between 15 and 300 minutes.");
    }
    return Math.round((minutes / 60) * 100) / 100; // Convert to hours and round to two decimal places
  }

  // Handle input in hours
  const hours = parseFloat(timeFrame);
  if (isNaN(hours) || hours < 0.25 || hours > 5) {
    throw new Error("Invalid time frame. Please enter a number between 0.25 and 5 hours, or 15 and 300 minutes.");
  }
  return Math.round(hours * 100) / 100; // Round to two decimal places
};

const validateAndParseMinAmountOrPercentage = (input, totalSupply, decimals) => {
  if (!input) {
    // Set a default value of 1% if no input is provided
    return { minAmount: BigInt(Math.floor((totalSupply * 0.01) * Math.pow(10, decimals))), minPercentage: 1 };
  }

  // Remove '%' if present and convert to number
  const value = parseFloat(input.replace('%', ''));

  if (isNaN(value) || value < 0.1 || value > 2) {
    throw new Error("Invalid input. Please enter a percentage between 0.1% and 2%.");
  }

  const minPercentage = value;
  const minAmount = BigInt(Math.floor((totalSupply * minPercentage / 100) * Math.pow(10, decimals)));

  return { minAmount, minPercentage };
};

const handleCrossCommand = async (bot, msg, args) => {
  console.log('Entering handleCrossCommand');
  const DEFAULT_MIN_COMBINED_VALUE = 1000; 
  try {
    if (args.length < 2) {
      await bot.sendLongMessage(msg.chat.id, "Please provide at least two coin addresses and optionally a minimum combined value. Usage: /cross <coin_address1> <coin_address2> [coin_address3...] [min_value]");
      return;
    }

    let minCombinedValue = DEFAULT_MIN_COMBINED_VALUE;
    let contractAddresses = [];

    // Parcourir l'input pour séparer les adresses du montant minimum
    for (const item of input) {
      if (!isNaN(Number(item)) && contractAddresses.length >= 2) {
        minCombinedValue = parseFloat(item);
      } else if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(item)) {
        contractAddresses.push(item);
      } else {
        console.log('Invalid input:', item);
        await bot.sendLongMessage(msg.chat.id, `Invalid input: ${item}. Please provide valid Solana addresses.`);
        return;
      }
    }

    console.log('Contract addresses:', contractAddresses);
    console.log('Minimum combined value:', minCombinedValue);

    if (contractAddresses.length < 2) {
      await bot.sendLongMessage(msg.chat.id, "Please provide at least two valid coin addresses.");
      return;
    }

      if (contractAddresses.length < 2) {
          await bot.sendLongMessage(msg.chat.id, "Please provide at least two coin addresses.");
          return;
      }

      await bot.sendLongMessage(msg.chat.id, `Starting cross-analysis for ${contractAddresses.length} coins with minimum combined value of $${minCombinedValue}...`);

      console.log('Calling crossAnalyze function with params:', JSON.stringify({ contractAddresses, minCombinedValue }));
      const filteredHolders = await crossAnalyze(contractAddresses, minCombinedValue, 'crossWallet');
      console.log(`Cross-analysis complete. Found ${filteredHolders.length} common holders.`);  

      if (!Array.isArray(filteredHolders) || filteredHolders.length === 0) {
          await bot.sendLongMessage(msg.chat.id, "No common holders found matching the criteria.");
          return;
      }

      const tokenInfos = await Promise.all(contractAddresses.map(async (address) => {
          try {
              const tokenInfo = await dexScreenerApi.getTokenInfo(address);
              return {
                  address: address,
                  symbol: tokenInfo.symbol,
                  name: tokenInfo.name
              };
          } catch (error) {
              console.error(`Error fetching token info for ${address}:`, error);
              return {
                  address: address,
                  symbol: 'Unknown',
                  name: 'Unknown'
              };
          }
      }));

      console.log('Formatting and sending cross-analysis message');

      // Call the function to format and send the message
      await sendFormattedCrossAnalysisMessage(bot, msg.chat.id, filteredHolders, contractAddresses, tokenInfos);

      console.log('Results sent to user');

  } catch (error) {
      console.error('Error in handleCrossCommand:', error);

      if (error.response && error.response.statusCode === 400 && error.response.body && error.response.body.description.includes('message is too long')) {
          await bot.sendLongMessage(msg.chat.id, "An error occurred during cross-analysis: The resulting message is too long to send via Telegram.\n\nPlease try with a higher minimum combined value or reduce the number of coins. Usage: /cross [coin_address1] [coin_address2] ... [Combined_value_min]");
      } else {
          await bot.sendLongMessage(msg.chat.id, `An error occurred during cross-analysis: ${error.message}`);
      }
  } finally {
    ApiCallCounter.logApiCalls('crossWallet');
  }  
};

const handleTeamSupplyCommand = async (bot, msg, args) => {
  try {
    const [tokenAddress] = args;

    await bot.sendLongMessage(msg.chat.id, `Analyzing team supply for token: ${tokenAddress}\nThis may take a few minutes...`);


    const { formattedResults, allWalletsDetails, allTeamWallets, tokenInfo } = await analyzeTeamSupply(tokenAddress, 'teamSupply');

    if (!formattedResults || formattedResults.trim() === '') {
        throw new Error('Analysis result is empty');
    }

    const initialSupplyPercentage = parseFloat(formattedResults.match(/Supply Controlled by team\/insiders: ([\d.]+)%/)[1]);

    lastAnalysisResults[msg.chat.id] = { 
      tokenAddress,
      tokenInfo: {
        ...tokenInfo,
      },
      teamWallets: allTeamWallets,
      topHoldersWallets: [],
      allWalletsDetails, 
      initialSupplyPercentage,
      totalSupplyControlled: initialSupplyPercentage,
      analysisType: 'teamSupplyAnalyzer',
      trackType: 'team',
      username: msg.from.username
    };

    await bot.sendLongMessage(msg.chat.id, formattedResults, { 
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "Track Team Wallets", callback_data: `track_team_${tokenAddress.substring(0, 20)}` },
                    { text: "Show Team Wallets Details", callback_data: `details_${tokenAddress.substring(0, 20)}` }
                ]
            ]
        },
        disable_web_page_preview: true
    });
  } catch (error) {
      console.error('Error in handleTeamSupplyCommand:', error);
      await bot.sendLongMessage(msg.chat.id, `An error occurred during team supply analysis: ${error.message}`);
  } finally {
    ApiCallCounter.logApiCalls('teamSupply');
  }
};

const handleCallbackQuery = async (bot, callbackQuery) => {
  const action = callbackQuery.data;
  const chatId = callbackQuery.message.chat.id;
  const username = callbackQuery.from.username;
  console.log('Received callback query:', action);

  try {
    let [actionType, tokenAddress, param] = action.split('_');
    console.log('Action type:', actionType, 'Token Address:', tokenAddress, 'Param:', param);

    let trackingInfo = lastAnalysisResults[chatId];

    switch (actionType) {
      case 'track':
        return await handleTrackAction(bot, chatId, tokenAddress, trackingInfo);
      case 'details':
        if (!trackingInfo || !trackingInfo.allWalletsDetails || !trackingInfo.tokenInfo) {
          throw new Error("No wallet details or token information found. Please run the analysis again.");
        }
        return await sendWalletDetails(bot, chatId, trackingInfo.allWalletsDetails, trackingInfo.tokenInfo);
      case 'sd':
        await handleSetDefaultThreshold(bot, chatId, trackingInfo, tokenAddress);
        break;
      case 'sc':
        await handleSetCustomThreshold(bot, chatId, trackingInfo, tokenAddress);
        break;
      case 'st':
        await handleStartTracking(bot, chatId, trackingInfo, parseFloat(param) || 1);
        break;
      case 'stop':
        // New case for handling stop tracking
        const trackerId = `${tokenAddress}_${param}`; // Assuming param is 'team' or 'topHolders'
        const success = supplyTrackerInstance.stopTracking(username, trackerId);
        if (success) {
          await bot.answerCallbackQuery(callbackQuery.id, { text: "Tracking stopped successfully." });
          await bot.editMessageText("Tracking stopped. Use /tracker to see your current trackers.", {
            chat_id: chatId,
            message_id: callbackQuery.message.message_id
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
    console.error('Error in handleCallbackQuery:', error);
    const errorMessage = `An error occurred: ${error.message}. Please try again or contact support.`;
    await bot.sendLongMessage(chatId, errorMessage);
    if (!callbackQuery.answered) {
      await bot.answerCallbackQuery(callbackQuery.id, { text: "An error occurred", show_alert: true });
    }
  }
};

const handleTrackAction = async (bot, chatId, tokenAddress, trackingInfo) => {
  console.log('Entering handleTrackAction');
  console.log('ChatId:', chatId);
  console.log('TokenAddress:', tokenAddress);
  console.log('Tracking Info:', JSON.stringify(trackingInfo, null, 2));

  const totalSupply = trackingInfo.tokenInfo?.totalSupply;
  const decimals = trackingInfo.tokenInfo?.decimals || 6;
  const ticker = trackingInfo.tokenInfo?.symbol || 'Unknown';
  const initialSupplyPercentage = trackingInfo.totalSupplyControlled || trackingInfo.initialSupplyPercentage || 0;
  const trackType = trackingInfo.analysisType === 'tokenScanner' ? 'topHolders' : 'team';
  const username = trackingInfo.username;
  
  console.log('Extracted info:');
  console.log('Total Supply:', totalSupply);
  console.log('Decimals:', decimals);
  console.log('Ticker:', ticker);
  console.log('Initial Supply Percentage:', initialSupplyPercentage);
  console.log('Track Type:', trackType);
  console.log('Username:', username);

  const supplyType = trackType === 'team' ? 'team supply' : 'total supply';
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

  console.log('Sending message with keyboard');
  await bot.sendLongMessage(chatId, message, { reply_markup: keyboard });
  console.log('Message sent successfully');
};

const handleStartTracking = async (bot, chatId, trackingInfo, threshold) => {
  console.log('Entering handleStartTracking');
  console.log('ChatId:', chatId);
  console.log('Threshold:', threshold);
  console.log('Tracking Info:', JSON.stringify(trackingInfo, null, 2));

  const { tokenAddress, teamWallets, topHoldersWallets, initialSupplyPercentage, tokenInfo, username, analysisType } = trackingInfo;
  const trackType = trackingInfo.trackType || (trackingInfo.analysisType === 'tokenScanner' ? 'topHolders' : 'team');
  const totalSupply = tokenInfo.totalSupply;

  console.log('Extracted info:');
  console.log('Track Type:', trackType);
  console.log('Token Address:', tokenAddress);
  console.log('Team Wallets:', JSON.stringify(teamWallets, null, 2));
  console.log('Top Holders Wallets:', JSON.stringify(topHoldersWallets, null, 2));
  console.log('Initial Supply Percentage:', initialSupplyPercentage);
  console.log('Total Supply:', totalSupply);
  console.log('Token Info:', JSON.stringify(tokenInfo, null, 2));
  console.log('Username:', username);

  const wallets = trackType === 'team' ? teamWallets : topHoldersWallets;
  
  console.log('Selected Wallets for tracking:', JSON.stringify(wallets, null, 2));
  
  if (!wallets || wallets.length === 0) {
    console.warn(`No ${trackType} wallets found for ${tokenAddress}. This may cause issues with tracking.`);
    await bot.sendLongMessage(chatId, `Warning: No ${trackType} wallets found. Tracking may not work as expected.`);
    return;
  }

  console.log('Total supply for', tokenAddress, 'is:', totalSupply);

  try {
    console.log('Calling supplyTrackerInstance.startTracking with params:');
    console.log('Token Address:', tokenAddress);
    console.log('ChatId:', chatId);
    console.log('Wallets:', JSON.stringify(wallets, null, 2));
    console.log('Initial Supply Percentage:', initialSupplyPercentage);
    console.log('Total Supply:', totalSupply);
    console.log('Threshold:', threshold);
    console.log('Symbol:', tokenInfo.symbol);
    console.log('Decimals:', tokenInfo.decimals);
    console.log('Track Type:', trackType);
    console.log('Username:', username);

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

    await bot.sendLongMessage(chatId, `Tracking started for ${tokenInfo.symbol} ${trackType} supply with ${threshold}% threshold. Use /tracker to see and manage your active trackings.`);
    console.log('SupplyTracker.startTracking called successfully');
  } catch (error) {
    console.error("Error starting tracking:", error);
    await bot.sendLongMessage(chatId, `An error occurred while starting the tracking: ${error.message}`);
  }
};

const handleStopCommand = async (bot, msg, args) => {
  const chatId = msg.chat.id;
  const username = msg.from.username;
  const [trackerId] = args;

  try {
    const success = supplyTrackerInstance.stopTracking(username, trackerId);
    if (success) {
      await bot.sendLongMessage(chatId, `Tracking stopped for ${trackerId}`);
    } else {
      await bot.sendLongMessage(chatId, `No active tracking found for ${trackerId}`);
    }
  } catch (error) {
    console.error(`Error stopping tracking: ${error.message}`);
    await bot.sendLongMessage(chatId, "An error occurred while stopping the tracking.");
  }
};

const handleTrackerCommand = async (bot, msg, args) => {
  const chatId = msg.chat.id;
  const username = msg.from.username;

  const trackedSupplies = supplyTrackerInstance.getTrackedSuppliesByUser(username);

  if (trackedSupplies.length === 0) {
    await bot.sendLongMessage(chatId, "You are not currently tracking any supplies. To start tracking supplies please run /team or /scan first");
    return;
  }

  let message = "Your currently tracked supplies:\n\n";
  const inlineKeyboard = [];

  trackedSupplies.forEach((supply, index) => {
    message += `${index + 1}. ${supply.ticker} (${supply.tokenAddress})\n`;
    message += `   Type: ${supply.trackType}, Current supply: ${supply.currentSupplyPercentage}%\n\n`;
    
    inlineKeyboard.push([{
      text: `Stop tracking ${supply.ticker}`,
      callback_data: `stop_${supply.tokenAddress}_${supply.trackType}`
    }]);
  });

  await bot.sendLongMessage(chatId, message, {
    reply_markup: {
      inline_keyboard: inlineKeyboard
    }
  });
};

const handleSetDefaultThreshold = async (bot, chatId, trackingInfo, trackingId) => {
  trackingInfo.threshold = 1;
  await bot.sendLongMessage(chatId, `Threshold set to default (1%)`);
  pendingTracking.set(trackingId, trackingInfo);
};

const handleSetCustomThreshold = async (bot, chatId, trackingInfo, trackingId) => {
  await bot.sendLongMessage(chatId, "Enter new supply change (ex: 2.5):");
  trackingInfo.awaitingCustomThreshold = true;
  pendingTracking.set(trackingId, trackingInfo);
};

const handleMessage = async (bot, msg) => {
  const chatId = msg.chat.id;
  const trackingInfo = pendingTracking.get(chatId);
  
  if (trackingInfo && trackingInfo.awaitingCustomThreshold) {
    const threshold = parseFloat(msg.text);
    if (isNaN(threshold) || threshold <= 0 || threshold > 100) {
      await bot.sendLongMessage(chatId, "Please enter a valid number between 0 and 100 for the threshold.");
      return;
    }
    
    trackingInfo.threshold = threshold;
    trackingInfo.awaitingCustomThreshold = false;
    pendingTracking.set(chatId, trackingInfo);

    const message = `🔁 Ready to track ${trackingInfo.tokenInfo.symbol} ${trackingInfo.trackType} supply (${trackingInfo.initialSupplyPercentage.toFixed(2)}%)\n\n` +
                    `You will receive a notification when supply changes by more than ${threshold}%`;

    const keyboard = {
      inline_keyboard: [
        [
          { text: "1%", callback_data: `set_default_threshold_${trackingInfo.trackType}_${trackingInfo.tokenAddress.substring(0, 20)}` },
          { text: `✅${threshold}%`, callback_data: `set_custom_threshold_${trackingInfo.trackType}_${trackingInfo.tokenAddress.substring(0, 20)}` }
        ],
        [{ text: "Start tracking", callback_data: `start_tracking_${trackingInfo.trackType}_${trackingInfo.tokenAddress.substring(0, 20)}` }]
      ]
    };

    await bot.sendLongMessage(chatId, message, { reply_markup: keyboard });
  }
};


const handleSearchCommand = async (bot, msg, args) => {
  try {
    const [tokenAddress, ...searchCriteria] = args;

    if (searchCriteria.length === 0) {
      await bot.sendLongMessage(msg.chat.id, "Please provide search criteria.");
      return;
    }

    await bot.sendLongMessage(msg.chat.id, `Searching wallets for coin: ${coinAddress}`);

    const results = await searchWallets(coinAddress, searchCriteria, 'searchWallet');

    if (results.length === 0) {
      await bot.sendLongMessage(msg.chat.id, "No matching wallets found.");
      return;
    }

    let message = `Found ${results.length} matching wallet(s):\n\n`;
    message += results.join('');

    await bot.sendLongMessage(msg.chat.id, message, { parse_mode: 'HTML', disable_web_page_preview: true });

  } catch (error) {
    console.error(`Error in handleSearchCommand:`, error);
    await bot.sendLongMessage(msg.chat.id, `An error occurred during the search: ${error.message}`);
  } finally {
    ApiCallCounter.logApiCalls('searchWallet');
  }
};

const handleBundleCommand = async (bot, msg, args) => {
  try {
    const [tokenAddress] = args;
    const bundleFinder = new BundleFinder();
    const bundleData = await bundleFinder.findBundle(tokenAddress);
    const formattedResponse = formatBundleResponse(bundleData);
    
    await bot.sendLongMessage(chatId, formattedResponse, { parse_mode: 'Markdown' });
  } catch (error) {
      console.error(`Error handling bundle command: ${error.message}`);
      await bot.sendLongMessage(chatId, 'An error occurred while processing your request. Please try again later.');
  } finally {
      ApiCallCounter.logApiCalls('bundle');
  }
};

const handleBestTradersCommand = async (bot, msg, args) => {
  console.log('Entering handleBestTradersCommand');
  try {
    const [contractAddress, ...otherArgs] = args;
    let winrateThreshold = 50;
    let portfolioThreshold = 10000;
    let sortOption = 'winrate';

    // Parse remaining arguments
    for (const arg of otherArgs) {
      const lowercaseArg = arg.toLowerCase();
      if (['pnl', 'winrate', 'wr', 'portfolio', 'port', 'sol'].includes(lowercaseArg)) {
        sortOption = lowercaseArg;
      } else {
        const num = parseFloat(arg);
        if (!isNaN(num)) {
          if (num >= 0 && num <= 100) {
            winrateThreshold = num;
          } else if (num > 100 && num <= 1000000) {
            portfolioThreshold = num;
          }
        }
      }
    }


    await bot.sendLongMessage(msg.chat.id, `Analyzing best traders for contract: ${contractAddress} with winrate >${winrateThreshold}% and portfolio value >$${portfolioThreshold}, sorted by ${sortOption}`);

    // Appel à la fonction d'analyse
    const bestTraders = await analyzeBestTraders(contractAddress, winrateThreshold, portfolioThreshold, sortOption, 'bestTraders');
        
    if (bestTraders.length === 0) {
      await bot.sendLongMessage(msg.chat.id, "No traders found meeting the criteria.");
      return;
    }

    const message = formatBestTraders(bestTraders, sortOption);

    await bot.sendLongMessage(msg.chat.id, message, { parse_mode: 'HTML', disable_web_page_preview: true });

  } catch (error) {
    console.error('Error in handleBestTradersCommand:', error);
    await bot.sendLongMessage(msg.chat.id, `An error occurred while processing your request: ${error.message}`);
  } finally {
    ApiCallCounter.logApiCalls('bestTraders');
  }
};

module.exports = {
  start: handleStartCommand,
  ping: handlePingCommand,
  scan: handleScanCommand,
  s: handleScanCommand,
  th: handleTopHoldersCommand,
  topholders: handleTopHoldersCommand,
  eb: handleEarlyBuyersCommand,
  earlybuyers: handleEarlyBuyersCommand,
  cross: handleCrossCommand,
  c: handleCrossCommand,
  team: handleTeamSupplyCommand,
  t: handleTeamSupplyCommand,
  search: handleSearchCommand,
  sh: handleSearchCommand,
  bundle: handleBundleCommand,
  bd: handleBundleCommand,
  bt: handleBestTradersCommand,
  besttraders: handleBestTradersCommand,
  tracker: handleTrackerCommand,
  tr: handleTrackerCommand,
  stop: handleStopCommand,
  initializeSupplyTracker,
  handleCallbackQuery,
  handleMessage
};