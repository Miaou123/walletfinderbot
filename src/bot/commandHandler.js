const dexScreenerApi = require('../integrations/dexScreenerApi');
const ApiCallCounter = require('../utils/ApiCallCounter');
const { formatEarlyBuyersMessage } = require('./formatters/earlyBuyersFormatter');
const { analyzeEarlyBuyers } = require('../analysis/earlyBuyers');
const { crossAnalyze } = require('../analysis/crossAnalyzer');
const { sendFormattedCrossAnalysisMessage } = require('./formatters/crossAnalysisFormatter');
const { formatBestTraders } = require('./formatters/bestTradersFormatter');
const { scanToken } = require('../analysis/topHoldersScanner');
const { formatAnalysisMessage } = require('./formatters/walletAnalyzerFormatter');
const { analyzeToken } = require('../analysis/topHoldersAnalyzer');
const { searchWallets } = require('../analysis/walletSearcher');
const { analyzeBestTraders } = require('../analysis/bestTraders');
const { analyzeTeamSupply, sendWalletDetails } = require('../analysis/teamSupply');
const { getAvailableSpots } = require('../utils/accessSpots');
const SupplyTracker = require('../tools/SupplyTracker');
const UserManager = require('./accessManager/userManager');
const ActiveCommandsTracker = require('./commandsManager/activeCommandsTracker'); 
const path = require('path');  
const fs = require('fs');
const logger = require('../utils/logger');

let lastAnalysisResults = {};
let supplyTrackerInstance;
let pendingTracking = new Map();
let userManager;

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

// Assurez-vous que ces fonctions peuvent gérer des entrées nulles ou undefined
const validateAndParseTimeFrame = (timeFrame) => {
  if (!timeFrame) return 1; // Default to 1 hour
  
  let value = parseFloat(timeFrame);
  let unit = timeFrame.replace(/[0-9.]/g, '').toLowerCase();

  if (unit === 'm' || unit === 'min') {
    value /= 60; // Convert minutes to hours
  }

  if (isNaN(value) || value < 0.25 || value > 5) {
    throw new Error("Invalid time frame. Please enter a number between 0.25 and 5 hours, or 15 and 300 minutes.");
  }

  return Math.round(value * 100) / 100; // Round to 2 decimal places
};

const validateAndParseMinAmountOrPercentage = (input, totalSupply, decimals) => {
  if (!input) {
    return { minAmount: BigInt(Math.floor((totalSupply * 0.01) * Math.pow(10, decimals))), minPercentage: 1 };
  }

  const value = parseFloat(input.replace('%', ''));

  if (isNaN(value) || value < 0.1 || value > 2) {
    throw new Error("Invalid input. Please enter a percentage between 0.1% and 2%.");
  }

  const minPercentage = value;
  const minAmount = BigInt(Math.floor((totalSupply * minPercentage / 100) * Math.pow(10, decimals)));

  return { minAmount, minPercentage };
};



const handleStartCommand = async (bot, msg, args) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username;

  // Vérification de l'initialisation de userManager
  if (!userManager) {
    logger.error('UserManager is not initialized. Ensure initializeUserManager is called before using the command.');
    return;
  }

  // Ajouter l'utilisateur à la liste des utilisateurs avec toutes les informations
  userManager.addUser(userId, chatId, username);

  const spotsInfo = getAvailableSpots();
  
  if (spotsInfo === null) {
    await bot.sendLongMessage(msg.chat.id, "An error occurred while processing your request. Please try again later.");
    return;
  }

  const { availableSpots, maxUsers } = spotsInfo;

  const startMessage = `
Welcome to Noesis! ✨🔍

For more information on the bot and the current beta phase, please check our <a href="https://smp-team.gitbook.io/noesis-bot">documentation</a> and follow us on <a href="https://x.com/NoesisTracker">twitter</a>.

If you are already whitelisted you can start by using /help for a full list of commands.

If you are not whitelisted yet:
• How to Join: DM @NoesisTracker on twitter or @rengon0x on Twitter/Telegram to request access.
• Available Spots: ${availableSpots}/${maxUsers}
• Selection Process: Access is granted on a first-come, first-served basis. Inactive users will be removed on a daily basis, and the total number of spots will be increased every week.

If you have any questions, want to report a bug or have any new feature suggestions feel free to dm @Rengon0x on telegram or twitter!

Please note that some commands may take longer to execute than expected. This is primarily due to API restrictions, as we're currently using lower-tier API access. 
As we advance, we intend to upgrade to higher tiers, which will result in 4–10x faster response times.

⚠️This bot is still in development phase and will probably be subject to many bugs/issues⚠️
  `;

  await bot.sendLongMessage(chatId, startMessage);
};

const handlePingCommand = async (bot, msg, args) => {
  const startTime = Date.now();
  
  await bot.sendLongMessage(msg.chat.id, 'Pinging...');
  
  const endTime = Date.now();
  const latency = endTime - startTime;
  
  await bot.sendLongMessage(msg.chat.id, `Pong! Latency is ${latency}ms`);
};
// Ajoutez cette fonction dans commandHandler.js
const handleAccessCommand = async (bot, msg) => {

  const spotsInfo = getAvailableSpots();

  if (spotsInfo === null) {
    await bot.sendLongMessage(msg.chat.id, "An error occurred while processing your request. Please try again later.");
    return;
  }

  const { availableSpots, maxUsers } = spotsInfo;


  const message = `
• Available Spots: ${availableSpots}/${maxUsers}
• How to Join: Please DM @rengon0x on Twitter or Telegram to request access.
• Selection Process: Access is granted on a first-come, first-served basis. Inactive users will be removed on a daily basis, and new spots will be available every week.
  `;

  await bot.sendLongMessage(msg.chat.id, message);
};

const handleScanCommand = async (bot, msg, args) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username;

  if (!userManager) {
    logger.error('UserManager is not initialized. Ensure initializeUserManager is called before using the command.');
    return;
  }

  userManager.addUser(userId, chatId, username);

  try {

    const [tokenAddress, numberOfHoldersStr] = args;
    const numberOfHolders = numberOfHoldersStr ? parseInt(numberOfHoldersStr) : 10;

    // Validation du nombre de détenteurs
    if (isNaN(numberOfHolders) || numberOfHolders < 1 || numberOfHolders > 100) {
      await bot.sendLongMessage(chatId, "Invalid number of holders. Please provide a number between 1 and 100.");
      return;
    }

    await bot.sendLongMessage(chatId, `Starting scan for token: ${tokenAddress}\nAnalyzing top ${numberOfHolders} holders. This may take a few minutes...`);

    const scanResult = await scanToken(tokenAddress, numberOfHolders, true, 'scan');

    if (!scanResult || !scanResult.formattedResult) {
      throw new Error("Scan result is incomplete or invalid.");
    }

    // Envoyer le résultat formaté
    await bot.sendLongMessage(chatId, scanResult.formattedResult, { 
      parse_mode: 'HTML', 
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Track Supply", callback_data: `track_${tokenAddress}` },
          ]
        ]
      }
    });

    // Harmoniser lastAnalysisResults
    if (scanResult.trackingInfo) {
      lastAnalysisResults[chatId] = null; 
      lastAnalysisResults[chatId] = {
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
      logger.debug(`Scan result received for ${tokenAddress}:`, scanResult);
      logger.debug(`Setting lastAnalysisResults for chatId ${chatId}:`, lastAnalysisResults[chatId]);
    } else {
      logger.warn(`Incomplete tracking info for token ${tokenAddress}`);
    }

  } catch (error) {
    logger.error('Error in handleScanCommand:', error);
    let errorMessage = `An error occurred during the token scan: ${error.message}`;
    
    if (error.message.includes("Unexpected token")) {
      errorMessage += "\nThere might be an issue with the API response. Please try again later.";
    } else if (error.message.includes("timeout")) {
      errorMessage += "\nThe request timed out. The server might be busy. Please try again in a few minutes.";
    }

    await bot.sendLongMessage(chatId, errorMessage);
  } finally {
    ApiCallCounter.logApiCalls('scan');
    ActiveCommandsTracker.removeCommand(userId, 'scan');
  }
};

const handleTopHoldersCommand = async (bot, msg, args) => {
  const userId = msg.from.id; 
  logger.info(`Starting TopHolders command for user ${msg.from.username}`);
  try {
    const [coinAddress, topHoldersCountStr] = args;
    const count = parseInt(topHoldersCountStr) || 20;

    if (isNaN(count) || count < 1 || count > 100) {
      await bot.sendLongMessage(msg.chat.id, "Invalid number of holders. Please provide a number between 1 and 100.");
      return;
    }

    await bot.sendLongMessage(msg.chat.id, `Starting top holders analysis for coin: ${coinAddress}\nThis may take a few minutes...`);
    
    const { tokenInfo, analyzedWallets } = await analyzeToken(coinAddress, count, 'Analyze');
    
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
  } catch (error) {
    logger.error('Error in handleTopHoldersCommand:', error);
    await bot.sendLongMessage(msg.chat.id, `An error occurred during analysis: ${error.message}`);
  } finally {
    logger.debug('TopHolders command completed');
    ApiCallCounter.logApiCalls('Analyze');
    ActiveCommandsTracker.removeCommand(userId, 'th');
    
  }
};

const handleEarlyBuyersCommand = async (bot, msg, args) => {
  const userId = msg.from.id; 
  logger.info(`Starting EarlyBuyers command for user ${msg.from.username}`);
  try {
    let coinAddress, timeFrame, percentage, pumpFlag;
    
    // Fonction pour reconnaître le type d'argument
    const recognizeArgType = (arg) => {
      const lowerArg = arg.toLowerCase();
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(arg)) {
        return { type: 'address', value: arg };
      } else if (/^(\d+(\.\d+)?)(h|m|min)$/.test(lowerArg)) {
        return { type: 'time', value: lowerArg };
      } else if (/^(\d+(\.\d+)?%?)$/.test(lowerArg)) {
        return { type: 'percentage', value: lowerArg.endsWith('%') ? lowerArg : lowerArg + '%' };
      } else if (lowerArg === 'pump' || lowerArg === 'nopump') {
        return { type: 'flag', value: lowerArg };
      }
      return { type: 'unknown', value: arg };
    };

    // Traitement des arguments
    args.forEach(arg => {
      const { type, value } = recognizeArgType(arg);
      switch (type) {
        case 'address':
          coinAddress = value;
          break;
        case 'time':
          timeFrame = value;
          break;
        case 'percentage':
          percentage = value;
          break;
        case 'flag':
          pumpFlag = value;
          break;
        default:
          logger.warn(`Unknown argument type: ${arg}`);
      }
    });

    // Vérifications et valeurs par défaut
    if (!coinAddress) {
      throw new Error("Please provide a valid coin address.");
    }

    const hours = timeFrame ? validateAndParseTimeFrame(timeFrame) : 1; // Default to 1 hour if not provided
    if (hours === null) {
      throw new Error("Invalid time frame. Please enter a number between 0.25 and 5 hours, or 15 and 300 minutes.");
    }

    const tokenInfo = await dexScreenerApi.getTokenInfo(coinAddress);
    if (!tokenInfo) {
      throw new Error("Failed to fetch token information");
    }

    const { minPercentage } = validateAndParseMinAmountOrPercentage(percentage, tokenInfo.totalSupply, tokenInfo.decimals);

    let analysisType = "Standard";
    if (pumpFlag === 'pump') analysisType = "Pumpfun";
    if (pumpFlag === 'nopump') analysisType = "Pumpfun excluded";

    await bot.sendLongMessage(
      msg.chat.id,
      `🔎 Analyzing early buyers for <b>${tokenInfo.symbol}</b>\n` +
      `⏳ Time frame: <b>${hours} hours</b>\n` +
      `📊 Minimum percentage: <b>${minPercentage}%</b>\n` +
      `🚩 Analysis type: <b>${analysisType}</b>`,
      { parse_mode: 'HTML', disable_web_page_preview: true }
    );      

    const result = await analyzeEarlyBuyers(coinAddress, minPercentage, hours, tokenInfo, 'earlyBuyers', pumpFlag || '');

    if (!result || !result.earlyBuyers) {
      throw new Error("Invalid result from analyzeEarlyBuyers");
    }

    let formattedMessage = await formatEarlyBuyersMessage(result.earlyBuyers, tokenInfo, hours, coinAddress, pumpFlag);
    if (!formattedMessage || formattedMessage.length === 0) {
      formattedMessage = "No early buyers found or error in formatting the message.";
    }

    await bot.sendLongMessage(msg.chat.id, formattedMessage, { parse_mode: 'HTML', disable_web_page_preview: true });

  } catch (error) {
    logger.error(`Error in handleEarlyBuyersCommand:`, error);
    let errorMessage = `An error occurred during early buyers analysis: ${error.message}.`;
    if (error.stack) {
      logger.error("Error stack:", error.stack);
    }
    await bot.sendLongMessage(msg.chat.id, errorMessage);
  } finally {
    logger.debug('EarlyBuyers command completed');
    ApiCallCounter.logApiCalls('earlyBuyers');
    ActiveCommandsTracker.removeCommand(userId, 'eb');
  }
};

const handleCrossCommand = async (bot, msg, args) => {
  const userId = msg.from.id; 
  logger.info(`Starting Cross command for user ${msg.from.username}`);
  const DEFAULT_MIN_COMBINED_VALUE = 1000; 
  try {
    if (args.length < 2) {
      await bot.sendLongMessage(msg.chat.id, "Please provide at least two coin addresses and optionally a minimum combined value. Usage: /cross <coin_address1> <coin_address2> [coin_address3...] [min_value]");
      return;
    }

    let minCombinedValue = DEFAULT_MIN_COMBINED_VALUE;
    let contractAddresses = [];

    for (const item of args) {
      if (!isNaN(Number(item)) && contractAddresses.length >= 2) {
        minCombinedValue = parseFloat(item);
      } else if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(item)) {
        contractAddresses.push(item);
      } else {
        logger.info('Invalid input:', item);
        await bot.sendLongMessage(msg.chat.id, `Invalid input: ${item}. Please provide valid Solana addresses.`);
        return;
      }
    }

    if (contractAddresses.length < 2) {
      await bot.sendLongMessage(msg.chat.id, "Please provide at least two valid coin addresses.");
      return;
    }

    await bot.sendLongMessage(msg.chat.id, `Starting cross-analysis for ${contractAddresses.length} coins with minimum combined value of $${minCombinedValue}...`);

    const relevantHolders = await crossAnalyze(contractAddresses, minCombinedValue, 'crossWallet');
  
    if (!Array.isArray(relevantHolders) || relevantHolders.length === 0) {
      await bot.sendLongMessage(msg.chat.id, "No relevant holders found matching the criteria.");
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
        logger.error(`Error fetching token info for ${address}:`, error);
        return {
          address: address,
          symbol: 'Unknown',
          name: 'Unknown'
        };
      }
    }));

    await sendFormattedCrossAnalysisMessage(bot, msg.chat.id, relevantHolders, contractAddresses, tokenInfos);

  } catch (error) {
    logger.error('Error in handleCrossCommand:', error);
    if (error.response && error.response.statusCode === 400 && error.response.body && error.response.body.description.includes('message is too long')) {
      await bot.sendLongMessage(msg.chat.id, "An error occurred during cross-analysis: The resulting message is too long to send via Telegram.\n\nPlease try with a higher minimum combined value or reduce the number of coins. Usage: /cross [coin_address1] [coin_address2] ... [Combined_value_min]");
    } else {
      await bot.sendLongMessage(msg.chat.id, `An error occurred during cross-analysis: ${error.message}`);
    }
  } finally {
    logger.debug('Cross command completed');
    ApiCallCounter.logApiCalls('crossWallet');
    ActiveCommandsTracker.removeCommand(userId, 'cross');
  }  
};

const handleTeamSupplyCommand = async (bot, msg, args) => {
  const userId = msg.from.id; 
  logger.info(`Starting Team Supply command for user ${msg.from.username}`);
  try {
    const [tokenAddress] = args;

    await bot.sendLongMessage(msg.chat.id, `Analyzing team supply for token: ${tokenAddress}\nThis may take a few minutes...`);

    const { formattedResults, allWalletsDetails, allTeamWallets, tokenInfo } = await analyzeTeamSupply(tokenAddress,'teamSupply');

    if (!formattedResults || formattedResults.trim() === '') {
      throw new Error('Analysis result is empty');
    }

    const initialSupplyPercentage = parseFloat(formattedResults.match(/Supply Controlled by team\/insiders: ([\d.]+)%/)[1]);

    lastAnalysisResults[msg.chat.id] = null;
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
            { text: "Track Team Wallets", callback_data: `track_${tokenAddress}_team` },
            { text: "Show Team Wallets Details", callback_data: `details_${tokenAddress}` }
          ]
        ]
      },
      disable_web_page_preview: true
    });
  } catch (error) {
    logger.error('Error in handleTeamSupplyCommand:', error);
    await bot.sendLongMessage(msg.chat.id, `An error occurred during team supply analysis: ${error.message}`);
  } finally {
    logger.debug('handleTeamSupplyCommand command completed');
    ApiCallCounter.logApiCalls('teamSupply');
    ActiveCommandsTracker.removeCommand(userId, 'team');
  }
};

const handleSearchCommand = async (bot, msg, args) => {
  const userId = msg.from.id; 
  logger.info(`Starting Search command for user ${msg.from.username}`);
  try {
    const [tokenAddress, ...searchCriteria] = args;

    if (searchCriteria.length === 0) {
      await bot.sendLongMessage(msg.chat.id, "Please provide search criteria.");
      return;
    }

    await bot.sendLongMessage(msg.chat.id, `Searching wallets for coin: ${tokenAddress}`);

    const results = await searchWallets(tokenAddress, searchCriteria, 'searchWallet');

    if (results.length === 0) {
      await bot.sendLongMessage(msg.chat.id, "No matching wallets found.");
      return;
    }

    let message = `Found ${results.length} matching wallet(s):\n\n`;
    message += results.join('');

    await bot.sendLongMessage(msg.chat.id, message, { parse_mode: 'HTML', disable_web_page_preview: true });

  } catch (error) {
    logger.error(`Error in handleSearchCommand:`, error);
    await bot.sendLongMessage(msg.chat.id, `An error occurred during the search: ${error.message}`);
  } finally {
    logger.debug('Search command completed');
    ApiCallCounter.logApiCalls('searchWallet');
    ActiveCommandsTracker.removeCommand(userId, 'search');
  }
};

const handleBestTradersCommand = async (bot, msg, args) => {
  const userId = msg.from.id; 
  logger.info(`Starting BestTrader command for user ${msg.from.username}`);
  try {
    const [contractAddress, ...otherArgs] = args;
    let winrateThreshold = 50;
    let portfolioThreshold = 10000;
    let sortOption = 'winrate';

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

    const bestTraders = await analyzeBestTraders(contractAddress, winrateThreshold, portfolioThreshold, sortOption, 'bestTraders');
        
    if (bestTraders.length === 0) {
      await bot.sendLongMessage(msg.chat.id, "No traders found meeting the criteria.");
      return;
    }

    const message = formatBestTraders(bestTraders, sortOption);

    await bot.sendLongMessage(msg.chat.id, message, { parse_mode: 'HTML', disable_web_page_preview: true });

  } catch (error) {
    logger.error('Error in handleBestTradersCommand:', error);
    await bot.sendLongMessage(msg.chat.id, `An error occurred while processing your request: ${error.message}`);
  } finally {
    logger.debug('bestTraders command completed');
    ApiCallCounter.logApiCalls('bestTraders');
    ActiveCommandsTracker.removeCommand(userId, 'bt');
  }
};

const handleTrackerCommand = async (bot, msg, args) => {
  logger.info(`Starting Tracker command for user ${msg.from.username}`);
  const chatId = msg.chat.id;
  const username = msg.from.username;

  const trackedSupplies = supplyTrackerInstance.getTrackedSuppliesByUser(username);
  console.log("Tracked supplies:", trackedSupplies);

  if (trackedSupplies.length === 0) {
    await bot.sendLongMessage(chatId, "You are not currently tracking any supplies. To start tracking supplies, please run /team or /scan first.");
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
    parse_mode: 'HTML'
  });
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
    logger.error(`Error stopping tracking: ${error.message}`);
    await bot.sendLongMessage(chatId, "An error occurred while stopping the tracking.");
  }
};

const userStates = new Map();

const handleCallbackQuery = async (bot, callbackQuery) => {
  const action = callbackQuery.data;
  const chatId = callbackQuery.message.chat.id;
  const username = callbackQuery.from.username;

  try {
    const [actionType, ...params] = action.split('_');
    let tokenAddress, threshold, trackType;

    logger.debug(`Callback query: actionType=${actionType}, params=${params}`);

    switch (actionType) {
      case 'track':
        tokenAddress = params[0];
        trackType = params[1] || 'topHolders';
        break;
      case 'st':
      case 'sd':
      case 'sc':
        tokenAddress = params[0];
        if (actionType === 'st') {
          threshold = parseFloat(params[1]);
        }
        break;
      case 'stop':
        tokenAddress = params[0];
        trackType = params[1];
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
        return await handleTrackAction(bot, chatId, tokenAddress, trackingInfo);

      case 'details':
        if (!trackingInfo || !trackingInfo.allWalletsDetails || !trackingInfo.tokenInfo) {
          throw new Error("No wallet details or token information found. Please run the analysis again.");
        }
        return await sendWalletDetails(bot, chatId, trackingInfo.allWalletsDetails, trackingInfo.tokenInfo);

      case 'sd':
        await handleSetDefaultThreshold(bot, chatId, trackingInfo, trackingId);
        break;

      case 'sc':
        await handleSetCustomThreshold(bot, chatId, trackingInfo, trackingId);
        break;

      case 'st':
        if (!trackingInfo) {
          await bot.answerCallbackQuery(callbackQuery.id, { 
            text: "Tracking information is outdated. Please run the scan again.", 
            show_alert: true 
          });
          return;
        }
        await handleStartTracking(bot, chatId, trackingInfo, threshold);
        break;

      case 'stop':
        const trackerId = `${tokenAddress}_${trackType}`;
        logger.debug(`Attempting to stop tracking for trackerId: ${trackerId}`);
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
    logger.error('Error in handleCallbackQuery:', error);
    const errorMessage = `An error occurred: ${error.message}. Please try again or contact support.`;
    await bot.sendLongMessage(chatId, errorMessage);
    if (!callbackQuery.answered) {
      await bot.answerCallbackQuery(callbackQuery.id, { text: "An error occurred", show_alert: true });
    }
  }
};

const handleTrackAction = async (bot, chatId, tokenAddress, trackingInfo, trackType) => {
  logger.debug(`Starting handleTrackAction for token: ${tokenAddress}, chatId: ${chatId}, trackType: ${trackType}`);
  logger.debug(`Current trackingInfo:`, trackingInfo);
  try {
    if (!trackingInfo || !trackingInfo.tokenInfo || trackingInfo.tokenAddress !== tokenAddress) {
      logger.error(`Mismatch in token addresses. Received: ${tokenAddress}, Expected: ${trackingInfo ? trackingInfo.tokenAddress : 'undefined'}`);
      throw new Error('Invalid or outdated tracking info');
    }

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

    // Use bot.sendMessage to get the sentMessage object with message_id
    const sentMessage = await bot.sendMessage(chatId, message, { reply_markup: keyboard, parse_mode: 'HTML' });
    trackingInfo.messageId = sentMessage.message_id;
    trackingInfo.trackType = trackType;  // Add this line to ensure trackType is saved

    // Update lastAnalysisResults and pendingTracking
    lastAnalysisResults[chatId] = trackingInfo;
    const trackingId = `${chatId}_${tokenAddress}`;
    pendingTracking.set(trackingId, trackingInfo);

    logger.info('Track action message sent successfully');
  } catch (error) {
    logger.error('Error in handleTrackAction:', error);
    try {
      await bot.sendMessage(chatId, `An error occurred while setting up tracking: ${error.message}. Please try again or contact support.`);
    } catch (sendError) {
      logger.error('Error sending error message to user:', sendError);
    }
  }
};


const handleSetDefaultThreshold = async (bot, chatId, trackingInfo, trackingId) => {
  trackingInfo.threshold = 1;
  pendingTracking.set(trackingId, trackingInfo);
  await updateTrackingMessage(bot, chatId, trackingInfo, trackingId);
};

const updateTrackingMessage = async (bot, chatId, trackingInfo, trackingId) => {
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
      reply_markup: keyboard
    });
  } catch (error) {
    logger.error('Error updating tracking message:', error);
  }
};

const handleSetCustomThreshold = async (bot, chatId, trackingInfo, trackingId) => {
  await bot.sendLongMessage(chatId, "Enter new supply change percentage (e.g., 2.5):");
  trackingInfo.awaitingCustomThreshold = true;
  pendingTracking.set(trackingId, trackingInfo);

  userStates.set(chatId, {
    action: 'awaiting_custom_threshold',
    trackingId: trackingId
  });
};

const handleStartTracking = async (bot, chatId, trackingInfo, threshold) => {
  threshold = trackingInfo.threshold || threshold || 1;
  const { tokenAddress, teamWallets, topHoldersWallets, initialSupplyPercentage, tokenInfo, username, analysisType } = trackingInfo;
  const trackType = trackingInfo.trackType || (trackingInfo.analysisType === 'tokenScanner' ? 'topHolders' : 'team');
  const totalSupply = tokenInfo.totalSupply;

  logger.debug(`Starting tracking for ${tokenAddress}`, { trackType, initialSupplyPercentage, totalSupply, threshold, username });

  logger.debug('Extracted info for Handle tracking:', { trackType, tokenAddress, teamWallets, topHoldersWallets, initialSupplyPercentage, totalSupply, tokenInfo, username });

  const wallets = trackType === 'team' ? teamWallets : topHoldersWallets;

  if (!wallets || wallets.length === 0) {
    logger.warn(`No ${trackType} wallets found for ${tokenAddress}. This may cause issues with tracking.`);
    await bot.sendLongMessage(chatId, `Warning: No ${trackType} wallets found. Tracking may not work as expected.`);
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

    await bot.sendLongMessage(chatId, `Tracking started for ${tokenInfo.symbol} ${trackType} supply with ${threshold}% threshold. Use /tracker to see and manage your active trackings.`);
    logger.info('SupplyTracker.startTracking called successfully');
  } catch (error) {
    logger.error("Error starting tracking:", error);
    await bot.sendLongMessage(chatId, `An error occurred while starting the tracking: ${error.message}`);
  }
};

const handleMessage = async (bot, msg) => {
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const userState = userStates.get(chatId);

  if (userState && userState.action === 'awaiting_custom_threshold') {
    const trackingId = userState.trackingId;
    let trackingInfo = pendingTracking.get(trackingId);

    if (!trackingInfo) {
      await bot.sendLongMessage(chatId, "Tracking info not found. Please start over.");
      userStates.delete(chatId);
      return;
    }

    // Retirer le symbole '%' s'il est présent et vérifier la valeur
    const thresholdInput = text.replace('%', '').trim();
    const threshold = parseFloat(thresholdInput);

    // Vérifier si le seuil est valide (entre 0.1 et 100)
    if (isNaN(threshold) || threshold < 0.1 || threshold > 100) {
      await bot.sendLongMessage(chatId, "Invalid input. Please enter a number between 0.1 and 100 for the threshold.");
      return;
    }

    // Si l'entrée est correcte, continuer avec la mise à jour
    trackingInfo.threshold = threshold;
    trackingInfo.awaitingCustomThreshold = false;
    pendingTracking.set(trackingId, trackingInfo);

    await updateTrackingMessage(bot, chatId, trackingInfo, trackingId);
    userStates.delete(chatId);
  } else {
    // Gérer d'autres messages ou ignorer
  }
};



// Export all command handlers
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
  bt: handleBestTradersCommand,
  besttraders: handleBestTradersCommand,
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