const { getDexScreenerApi } = require('../integrations/dexscreenerApi');
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

const handleStartCommand = (bot, msg) => {
  const newLocal = `
  Welcome to Noesis! ✨🔍
  
  Noesis is your go-to tool for in-depth analysis of Solana coins and discovering new wallets worth tracking. Our goal is to provide you with unique insights and help you stay ahead of the curve.
  🔒 Access is free, but you must send a direct message to @Rengon0x on Telegram or Twitter to have your Telegram handle whitelisted. Spots left: X/50 (more spots will be open in the upcoming weeks)
  This process ensures that we can manage the number of users and control the costs associated.

  If you are already whitelisted you can start by using /help
  /th 7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr 50

  Please use /help for a full list of commands.
  
  If you have any questions, want to report a bug or have any suggestion on new features feel free to dm @Rengon0x on telegram or twitter!
  
  ⚠️This bot is still in development phase and will probably be subject to many bugs/issues⚠️
  
  If you need any help, just type /help.
  `;
  const startMessage = newLocal;
  
  bot.sendLongMessage(msg.chat.id, startMessage);
  };
  
const handleHelpCommand = (bot, msg) => {
const helpMessage = `
Here's a list of available commands and their descriptions:

/ping - Check if the bot is online and get the response time
/scan or /s [contract_address] [number_of_top_holders](10)* - Scan a token for a top holders breakdown. Increasing the number of top holders analyzed is recommended for a better overview on high mcap tokens.
/bd or /bundle [contract_address] - Analyze bundle trades for a specific contract address
/bt or /besttraders [contract_address] [winrate_threshold](50%)* [portfolio_threshold]($10000)* [sort_option](port)*  - Analyse the 100 best traders for a specific contract with given winrate and portfolio thresholds (sort option can be winrate/wr, pnl, portfolio/port, sol)
/th or /topholders [contract_address] [number_of_holders](20)* - Analyze the top holders of a specific coin (default number is 20 but you can analyze up to 100 top holders).
/c or /cross [contract_address1] [contract_address2] ... [Combined_value_min]($10000)* - Search for wallets that holds multiple coins (you can go up to 5 coins) with a minimum combined value (default is $1000)
/t or /team [contract_address] - Analyze team and insider supply for a token with an homemade algorithm
/search [contract_address] [partial_address1] [partial_address2]* - Search for wallets that hold a specific token and match the partial addresses provided (you can had multiple parts to one partial address by separating them with one or multiple dots.)
/help - Show command list
* = optional parameters
() = default values

If you have any questions, want to report a bug or have any suggestion on new features feel free to dm @Rengon0x on telegram or twitter!

⚠️This bot is still in development phase and will probably be subject to many bugs/issues⚠️
`;

bot.sendLongMessage(msg.chat.id, helpMessage);
};

const handlePingCommand = async (bot, msg) => {
  const startTime = Date.now();
  const message = await bot.sendMessage(msg.chat.id, 'Pinging...');
  const endTime = Date.now();
  const latency = endTime - startTime;
  await bot.editMessageText(`Pong! Latency is ${latency}ms`, {
    chat_id: msg.chat.id,
    message_id: message.message_id
  });
};

const handleScanCommand = async (bot, msg, match) => {
  try {
    if (!match || !match[1]) {
      await bot.sendMessage(msg.chat.id, "Please provide a token address. Usage: /scan <token_address> [number_of_holders]");
      return;
    }

    const args = match[1].split(' ');
    const tokenAddress = args[0];
    const numberOfHolders = args[1] ? parseInt(args[1]) : 10;

    // Validation de l'adresse du token
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(tokenAddress)) {
      await bot.sendMessage(msg.chat.id, "Invalid token address format. Please provide a valid Solana address.");
      return;
    }

    // Validation du nombre de détenteurs
    if (isNaN(numberOfHolders) || numberOfHolders < 1 || numberOfHolders > 100) {
      await bot.sendMessage(msg.chat.id, "Invalid number of holders. Please provide a number between 1 and 100.");
      return;
    }

    await bot.sendMessage(msg.chat.id, `Starting scan for token: ${tokenAddress}\nAnalyzing top ${numberOfHolders} holders. This may take a few minutes...`);

    const scanResult = await scanToken(tokenAddress, numberOfHolders, true, 'scan');

    // Envoyer le résultat formaté
    await bot.sendMessage(msg.chat.id, scanResult.formattedResult, { 
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
    await bot.sendMessage(msg.chat.id, `An error occurred during the token scan: ${error.message}`);
  } finally {
    ApiCallCounter.logApiCalls('scan');
  }
};
  
const handleShowMoreWallets = async (bot, chatId, tokenAddress) => {
  try {
    const analysisResults = lastAnalysisResults[chatId];
    if (!analysisResults || analysisResults.tokenAddress !== tokenAddress) {
      throw new Error("Analysis results not found or mismatch in token address");
    }

    const { allAnalyzedWallets, displayedWallets, tokenInfo } = analysisResults;
    const remainingWallets = allAnalyzedWallets.slice(displayedWallets);

    if (remainingWallets.length === 0) {
      await bot.sendMessage(chatId, "No more wallets to display.");
      return;
    }

    const moreWalletsResult = formatAdditionalWallets(remainingWallets, tokenInfo, displayedWallets);
    await bot.sendLongMessage(chatId, moreWalletsResult, { 
      parse_mode: 'HTML', 
      disable_web_page_preview: true 
    });

    // Update the number of displayed wallets
    lastAnalysisResults[chatId].displayedWallets = allAnalyzedWallets.length;

  } catch (error) {
    console.error('Error in handleShowMoreWallets:', error);
    await bot.sendMessage(chatId, `An error occurred while fetching more wallets: ${error.message}`);
  }
};

function formatAdditionalWallets(wallets, tokenInfo, startRank) {
  let result = `<b>Additional Holders for ${tokenInfo.symbol}</b>\n\n`;

  wallets.forEach((wallet, index) => {
    const rank = startRank + index + 1;
    const emoji = getHoldingEmoji(wallet);
    result += `${rank} - <a href="https://solscan.io/account/${wallet.address}">${wallet.address.substring(0, 6)}...${wallet.address.slice(-4)}</a> → (${wallet.supplyPercentage}%) ${emoji}\n`;
    
    if (wallet.isInteresting) {
      result += `├ ❗️${wallet.category}\n`;
    }
    
    result += `├ 💳 Sol: ${wallet.solBalance}\n`;
    result += `└ 💲 Port: $${formatNumber(parseFloat(wallet.portfolioValue))}`;

    if (wallet.tokenInfos && wallet.tokenInfos.length > 0) {
      const topTokens = wallet.tokenInfos
        .filter(token => token.symbol !== 'SOL' && token.valueNumber >= 1000)
        .sort((a, b) => b.valueNumber - a.valueNumber)
        .slice(0, 3);

      if (topTokens.length > 0) {
        result += ` (${topTokens.map(token => 
          `<a href="https://dexscreener.com/solana/${token.mint}?maker=${wallet.address}">${token.symbol}</a> $${formatNumber(token.valueNumber)}`
        ).join(', ')})`;
      }
    }

    result += '\n\n';
  });

  return result;
}

const handleAnalyzeCommand = async (bot, msg, match) => {
  try {
    if (!match || !match[1]) {
      await (bot).sendLongMessage(msg.chat.id, "Please provide a coin address. Usage: /analyze <coin_address> [number_of_holders]");
      return;
    }
    const [coinAddress, topHoldersCount] = match[1].split(' ');

    // Validation de l'adresse du contrat
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(coinAddress)) {
      await (bot).sendLongMessage(msg.chat.id, "Invalid contract address format. Please provide a valid Solana address.");
      return;
    }

    // Validation du nombre de top holders
    const count = parseInt(topHoldersCount) || 20;
    if (isNaN(count) || count < 1 || count > 100) {
      await (bot).sendLongMessage(msg.chat.id, "Invalid number of holders. Please provide a number between 1 and 100.");
      return;
    }

    console.log(`User requested ${count} top holders`);

    await bot.sendLongMessage(msg.chat.id, `Starting top holders analysis for coin: ${coinAddress}\nThis may take a few minutes...`);
    
    // Effectuer l'analyse
    const { tokenInfo, analyzedWallets } = await analyzeToken(coinAddress, count, 'Analyze');
    
    // Vérifiez que analyzedWallets n'est pas vide
    if (analyzedWallets.length === 0) {
      await bot.sendMessage(msg.chat.id, "No wallets found for analysis.");
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
      await bot.sendMessage(msg.chat.id, "Some errors occurred during analysis. Please check the logs for more details.");
    }

  } catch (error) {
    console.error(`Error in handleAnalyzeCommand:`, error);
    await bot.sendMessage(msg.chat.id, `An error occurred during analysis: ${error.message}`);
  } finally {
    ApiCallCounter.logApiCalls('Analyze');
  }

};

const handleEarlyBuyersCommand = async (bot, msg, match) => {
  try {
    console.log("EB command triggered");
    
    if (!match || !match[1]) {
      console.log("No input provided");
      await bot.sendMessage(msg.chat.id, "Please provide a coin address. Usage: /eb <coin_address> [time_frame] [percentage]");
      return;
    }

    const [coinAddress, timeFrame, percentage] = match[1].split(' ');
    console.log(`Coin Address: ${coinAddress}, Time Frame: ${timeFrame}, Percentage: ${percentage}`);

    // Validation de l'adresse du contrat
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(coinAddress)) {
      await bot.sendMessage(msg.chat.id, "Invalid contract address format. Please provide a valid Solana address.");
      return;
    }

    // Validation du time frame
    const hours = validateAndParseTimeFrame(timeFrame);
    if (hours === null) {
      await bot.sendMessage(msg.chat.id, "Invalid time frame. Please enter a number between 0.25 and 5 hours, or 15 and 300 minutes.");
      return;
    }

    // Fetch token info to get decimals and total supply
    const dexScreenerApi = getDexScreenerApi();
    const tokenInfo = await dexScreenerApi.getTokenInfo(coinAddress);
    
    if (!tokenInfo) {
      throw new Error("Failed to fetch token information");
    }
    console.log("Token info fetched:", tokenInfo);

    // Validate and parse percentage
    const { minPercentage } = validateAndParseMinAmountOrPercentage(percentage, tokenInfo.totalSupply, tokenInfo.decimals);

    console.log(`Parsed time frame into hours: ${hours}, Min percentage: ${minPercentage}%`);

    await bot.sendMessage(
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

    const sentMessage = await bot.sendMessage(msg.chat.id, formattedMessage, { parse_mode: 'HTML', disable_web_page_preview: true });

  } catch (error) {
    console.error(`Error in handleEarlyBuyersCommand:`, error);
    let errorMessage = `An error occurred during early buyers analysis: ${error.message}.`;
    if (error.stack) {
      console.error("Error stack:", error.stack);
    }
    await bot.sendMessage(msg.chat.id, errorMessage);
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

const handleCrossCommand = async (bot, msg, match) => {
  console.log('Entering handleCrossCommand');
  const DEFAULT_MIN_COMBINED_VALUE = 1000; 
  try {
    if (!match || !match[1]) {
      console.log('Insufficient input provided');
      await bot.sendLongMessage(msg.chat.id, "Please provide at least two coin addresses and optionally a minimum combined value. Usage: /cross <coin_address1> <coin_address2> [coin_address3...] [min_value]");
      return;
    }

    console.log('Cross command input:', match[1]);
    const input = match[1].trim().split(' ');
    if (input.length < 2) {
      console.log('Insufficient input provided');
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

      const dexScreenerApi = getDexScreenerApi();
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

const handleTeamSupplyCommand = async (bot, msg, match) => {
  try {
    if (!match || !match[1]) {
      await bot.sendMessage(msg.chat.id, "Please provide a token address. Usage: /team <token_address>");
      return;
    }

    const tokenAddress = match[1].trim();

    // Validation de l'adresse du token
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(tokenAddress)) {
      await bot.sendMessage(msg.chat.id, "Invalid token address format. Please provide a valid Solana address.");
      return;
    }

    await bot.sendMessage(msg.chat.id, `Analyzing team supply for token: ${tokenAddress}\nThis may take a few minutes...`);

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

    await bot.sendMessage(msg.chat.id, formattedResults, { 
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
      await bot.sendMessage(msg.chat.id, `An error occurred during team supply analysis: ${error.message}`);
  } finally {
    ApiCallCounter.logApiCalls('teamSupply');
  }
};

// Modifiez handleCallbackQuery comme suit :
const handleCallbackQuery = async (bot, callbackQuery) => {
  const action = callbackQuery.data;
  const chatId = callbackQuery.message.chat.id;
  console.log('Received callback query:', action);

  try {
    let [actionType, tokenAddress, param] = action.split('_');
    console.log('Action type:', actionType, 'Token Address:', tokenAddress, 'Param:', param);

    let trackingInfo = lastAnalysisResults[chatId];
    if (!trackingInfo) {
      throw new Error("No analysis results found. Please run the scan or team command again.");
    }

    console.log('Tracking info:', JSON.stringify(trackingInfo, null, 2));

    switch (actionType) {
      case 'track':
        return await handleTrackAction(bot, chatId, tokenAddress, trackingInfo);
      case 'details':
        if (!trackingInfo.allWalletsDetails || !trackingInfo.tokenInfo) {
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
      case 'more':
        if (param === 'wallets') {
          await handleShowMoreWallets(bot, chatId, tokenAddress);
        }
        break;
      default:
        throw new Error(`Unknown action type: ${actionType}`);
    }

    await bot.answerCallbackQuery(callbackQuery.id);
  } catch (error) {
    console.error('Error in handleCallbackQuery:', error);
    const errorMessage = `An error occurred: ${error.message}. Please try again or contact support.`;
    await bot.sendMessage(chatId, errorMessage);
    if (!callbackQuery.answered) {
      await bot.answerCallbackQuery(callbackQuery.id, { text: "An error occurred", show_alert: true });
    }
  }
};

// Modifiez handleTrackAction comme suit :
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
  await bot.sendMessage(chatId, message, { reply_markup: keyboard });
  console.log('Message sent successfully');
};

// Modifiez handleStartTracking comme suit :
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
    await bot.sendMessage(chatId, `Warning: No ${trackType} wallets found. Tracking may not work as expected.`);
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

    console.log('SupplyTracker.startTracking called successfully');

    await bot.sendMessage(chatId, `Tracking started for ${tokenInfo.symbol} ${trackType} supply with ${threshold}% threshold.`);
    console.log('Success message sent to user');
  } catch (error) {
    console.error("Error starting tracking:", error);
    await bot.sendMessage(chatId, `An error occurred while starting the tracking: ${error.message}`);
  }
};

// Ajoutez cette nouvelle fonction pour gérer l'arrêt du tracking
const handleStopTracking = async (bot, msg, match) => {
  const chatId = msg.chat.id;
  const username = msg.from.username;
  const trackerId = match[1];

  try {
      supplyTrackerInstance.stopTracking(username, trackerId);
      await bot.sendMessage(chatId, `Tracking stopped for ${trackerId}`);
  } catch (error) {
      console.error(`Error stopping tracking: ${error.message}`);
      await bot.sendMessage(chatId, "An error occurred while stopping the tracking.");
  }
};

// Ajoutez cette nouvelle fonction pour afficher les trackings actifs
const handleTrackerCommand = async (bot, msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username;

  const trackedSupplies = supplyTrackerInstance.getTrackedSuppliesByUser(username);

  if (trackedSupplies.length === 0) {
      await bot.sendMessage(chatId, "You are not currently tracking any supplies.");
      return;
  }

  let message = "Your currently tracked supplies:\n\n";
  trackedSupplies.forEach((supply, index) => {
      message += `${index + 1}. ${supply.ticker} (${supply.tokenAddress})\n`;
      message += `   Type: ${supply.trackType}, Current supply: ${supply.currentSupplyPercentage}%\n`;
      message += `   /stop_${supply.trackerId}\n\n`;
  });

  await bot.sendMessage(chatId, message);
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


const handleSearchCommand = async (bot, msg, match) => {
  try {
    if (!match || !match[1]) {
      await bot.sendLongMessage(msg.chat.id, "Please provide a token address and search criteria. Usage: /search <token_address> <search_criteria>");
      return;
    }

    const [tokenAddress, ...searchCriteria] = match[1].split(' ');

    // Validation de l'adresse du token
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(tokenAddress)) {
      await bot.sendLongMessage(msg.chat.id, "Invalid token address format. Please provide a valid Solana address.");
      return;
    }

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

const handleBundleCommand = async (bot, msg, match) => {
  console.log('Entering handleBundleCommand');
  const chatId = msg.chat.id;
  const input = match[1]; // L'input est dans match[1] pour être cohérent avec les autres commandes

  console.log('chatId:', chatId);
  console.log('input:', input);

  try {
      if (!input) {
          await bot.sendMessage(chatId, "Please provide a contract address. Usage: /bundle <contract_address> or /bd <contract_address>");
          return;
      }

      const contractAddress = input.trim();

      // Validation de l'adresse du contrat Solana
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(contractAddress)) {
          await bot.sendMessage(chatId, "Invalid contract address format. Please provide a valid Solana address.");
          return;
      }

      const bundleFinder = new BundleFinder();
      const bundleData = await bundleFinder.findBundle(contractAddress);
      const formattedResponse = formatBundleResponse(bundleData);
      
      await bot.sendMessage(chatId, formattedResponse, { parse_mode: 'Markdown' });
  } catch (error) {
      console.error(`Error handling bundle command: ${error.message}`);
      await bot.sendMessage(chatId, 'An error occurred while processing your request. Please try again later.');
  } finally {
      ApiCallCounter.logApiCalls('bundle');
  }
};

const handleBestTradersCommand = async (bot, msg, match) => {
  console.log('Entering handleBestTradersCommand');
  try {
    if (!match || !match[1]) {
      await bot.sendLongMessage(msg.chat.id, "Please provide a contract address and optional parameters. Usage: /bt <contract_address> [winrate] [portfolio] [sort_option]");
      return;
    }

    const input = match[1].trim().split(' ');
    const contractAddress = input[0];
    let winrateThreshold = 50;
    let portfolioThreshold = 10000;
    let sortOption = 'winrate';

    // Validation de l'adresse du contrat
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(contractAddress)) {
      await bot.sendLongMessage(msg.chat.id, "Invalid contract address format. Please provide a valid Solana address.");
      return;
    }

    // Parse remaining arguments
    for (let i = 1; i < input.length; i++) {
      const arg = input[i].toLowerCase();
      if (arg === 'pnl' || arg === 'winrate' || arg === 'wr' || arg === 'portfolio' || arg === 'port' || arg === 'sol') {
        sortOption = arg;
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
  handlePingCommand,
  initializeSupplyTracker,
  handleStartCommand,
  handleSearchCommand,
  handleHelpCommand,
  handleAnalyzeCommand,
  handleEarlyBuyersCommand,
  handleCrossCommand,
  handleTeamSupplyCommand,
  handleScanCommand,
  handleCallbackQuery,
  handleMessage,
  handleBestTradersCommand,
  handleBundleCommand,
  handleStopTracking,
  handleTrackerCommand
};