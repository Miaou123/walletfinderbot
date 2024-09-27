const { getDexScreenerApi } = require('../integrations/dexscreenerApi');
const { formatEarlyBuyersMessage } = require('./formatters/earlyBuyersFormatter');
const { analyzeEarlyBuyers } = require('../analysis/earlyBuyers');
const { crossAnalyze } = require('../analysis/crossAnalyzer');
const { sendFormattedCrossAnalysisMessage } = require('./formatters/crossAnalysisFormatter');
const { scanToken } = require('../analysis/tokenScanner');
const { analyzeTeamSupply, sendWalletDetails } = require('../analysis/teamSupplyAnalyzer');
const { formatAnalysisMessage, getHoldingEmoji} = require('./formatters/walletAnalyzerFormatter');
const { analyzeToken } = require('../analysis/walletAnalyzer');
const { searchWallets } = require('../analysis/walletSearcher');

const ApiCallCounter = require('../utils/ApiCallCounter');

const SupplyTracker = require('../tools/SupplyTracker');

let pendingTracking = new Map();
let lastAnalysisResults = {};
let supplyTrackerInstance;

function initializeSupplyTracker(bot) {
  supplyTrackerInstance = new SupplyTracker(bot); // Create an instance
}
const handleStartCommand = (bot, msg) => {
  const newLocal = `
  Welcome to the Solana Coin Analysis Bot!
  
  This bot helps you analyze Solana coins and hunt for new wallets to track.
  This bot is currently free to use, but you must dM @Rengon0x (on telegram or twitter) to gain access (this is done to control how many people can use it and avoid the costs associated with having a large number of people using it).
  
  Here are the available commands:
  
  /ping to check if the bot is online
  /scan [coin_address] - Scan a token for a top 10 holders breakdown (can then be extended to 20 if necessary)
  /th [coin_address] [number_of_holders] - Analyze the top holders of a specific coin (default number is 20 but you can analyze up to 100 top holders).
  /cross [coin_address1] [coin_address2] ... [Combined_value_min] - Search for wallets that holds multiple coins (you can go up to 5 coins) with a minimum combined value (default is $1000)
  /team [coin_address] - Analyze team and insider supply for a token with an homemade algorithm
  /search [token_address] [partial_address1] [partial_address2] - Search for wallets that hold a specific token and match the partial addresses provided (you can had multiple parts to one partial address by separating them with one or multiple dots.)
  /help - Show command list
  
  To get started, use one of the commands above. For example:
  /th 7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr 50
  
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
  
  /ping to check if the bot is online
  /scan [coin_address] - Scan a token for a top 10 holders breakdown (can then bne extended to 20 if necessary)
  /th [coin_address] [number_of_holders] - Analyze the top holders of a specific coin (default number is 20 but you can analyze up to 100 top holders).
  /cross [coin_address1] [coin_address2] ... - Search for wallets that holds multiple coins (you can go up to 5 coins)
  /team [coin_address] - Analyze team and insider supply for a token with an homemade algorithm
  /search [token_address] [partial_address1] [partial_address2] - Search for wallets that hold a specific token and match the partial addresses provided (you can had multiple parts to one partial address by separating them with one or multiple dots.)
  /help - Show this help message
  
  If you have any questions, want to report a bug or have any suggestion on new features feel free to dm @Rengon0x on telegram or twitter!
  
  ⚠️This bot is still in development phase and will probably be subject to many bugs/issues⚠️
  `;
  
  bot.sendLongMessage(msg.chat.id, helpMessage);
  };



const handleScanCommand = async (bot, msg, match) => {
  try {
    const [tokenAddress, numberOfHolders] = match[1].split(' ');
    if (!tokenAddress) {
      await bot.sendMessage(msg.chat.id, "Please provide a token address. Usage: /scan <token_address> [number_of_holders]");
      return;
    }

    const holdersToAnalyze = parseInt(numberOfHolders) || 20; // Analyze 20 by default
    const holdersToDisplay = Math.min(10, holdersToAnalyze); // Display 10 by default

    await bot.sendMessage(msg.chat.id, `Starting scan for token: ${tokenAddress}\nAnalyzing top ${holdersToAnalyze} holders. This may take a few minutes...`);

    const scanResult = await scanToken(tokenAddress, holdersToAnalyze, true, 'scan');

    // Envoyer le résultat formaté
    await bot.sendMessage(msg.chat.id, scanResult.formattedResult, { 
      parse_mode: 'HTML', 
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Track Supply", callback_data: `track_total_${tokenAddress}` },
            { text: "Show more wallets", callback_data: `more_wallets_${tokenAddress}` }
          ]
        ]
      }
    });

    // Update lastAnalysisResults
    lastAnalysisResults[msg.chat.id] = {
      tokenAddress: scanResult.trackingInfo.tokenAddress,
      tokenInfo: {
        symbol: scanResult.trackingInfo.tokenSymbol,
        totalSupply: scanResult.trackingInfo.totalSupply,
        decimals: scanResult.trackingInfo.decimals
      },
      totalSupplyControlled: scanResult.trackingInfo.totalSupplyControlled,
      topHoldersWallets: scanResult.trackingInfo.topHoldersWallets,
      allAnalyzedWallets: scanResult.allAnalyzedWallets, // Store all analyzed wallets
      displayedWallets: holdersToDisplay, // Store the number of currently displayed wallets
      teamWallets: [], // Empty for scan command
      initialSupplyPercentage: scanResult.trackingInfo.totalSupplyControlled,
      analysisType: 'tokenScanner'
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
    const input = match[1];
    if (!input) {
      await bot.sendLongMessage(msg.chat.id, "Please provide a coin address. Usage: /th <coin_address> [number_of_holders]");
      return;
    }
    const [coinAddress, topHoldersCount] = input.split(' ');
    const count = parseInt(topHoldersCount) || 20;

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
    
    const input = match[1];
    if (!input) {
      console.log("No input provided");
      await bot.sendMessage(msg.chat.id, "Please provide a coin address. Usage: /eb <coin_address> [time_frame] [percentage]");
      return;
    }

    const [coinAddress, timeFrame, percentage] = input.split(' ');
    console.log(`Coin Address: ${coinAddress}, Time Frame: ${timeFrame}, Percentage: ${percentage}`);

    // Fetch token info to get decimals and total supply
    const dexScreenerApi = getDexScreenerApi();
    const tokenInfo = await dexScreenerApi.getTokenInfo(coinAddress);
    
    if (!tokenInfo) {
      throw new Error("Failed to fetch token information");
    }
    console.log("Token info fetched:", tokenInfo);

    // Validate and parse time frame
    const hours = validateAndParseTimeFrame(timeFrame);

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
    console.log("Formatted message:", formattedMessage);

    if (!formattedMessage || formattedMessage.length === 0) {
      formattedMessage = "No early buyers found or error in formatting the message.";
    }

    const sentMessage = await bot.sendMessage(msg.chat.id, formattedMessage, { parse_mode: 'HTML', disable_web_page_preview: true });
    console.log("Message sent to the user:", sentMessage);

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
    const DEFAULT_MIN_COMBINED_VALUE = 10000; 
    try {
        console.log('Cross command input:', match[1]);
        const input = match[1].trim().split(' ');
        if (input.length < 2) {
            console.log('Insufficient input provided');
            await bot.sendLongMessage(msg.chat.id, "Please provide at least two coin addresses and optionally a minimum combined value. Usage: /cross <coin_address1> <coin_address2> [coin_address3...] [min_value]");
            return;
        }

        let minCombinedValue = DEFAULT_MIN_COMBINED_VALUE;
        let contractAddresses = [];

        // Parse input to separate addresses and minimum value
        for (const item of input) {
            if (!isNaN(item) && contractAddresses.length >= 2) {
                minCombinedValue = parseFloat(item);
            } else {
                contractAddresses.push(item);
            }
        }

        console.log('Contract addresses:', contractAddresses);
        console.log('Minimum combined value:', minCombinedValue);

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
      const tokenAddress = match[1];
      if (!tokenAddress) {
          await bot.sendMessage(msg.chat.id, "Please provide a token address. Usage: /team <token_address>");
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
        analysisType: 'teamSupplyAnalyzer'
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

const handleCallbackQuery = async (bot, callbackQuery) => {
  const action = callbackQuery.data;
  const chatId = callbackQuery.message.chat.id;

  console.log('Received callback query:', action);

  try {
    let actionType, trackingId, tokenAddress;

    if (action.includes('_')) {
      [actionType, trackingId] = action.split('_');
      console.log('Action type:', actionType, 'Tracking ID:', trackingId);
    } else {
      throw new Error("Invalid callback data format");
    }

    let trackingInfo;

    if (actionType === 'track') {
      // This is the initial tracking action, use lastAnalysisResults
      trackingInfo = lastAnalysisResults[chatId];
      if (!trackingInfo) {
        throw new Error("No analysis results found. Please run the scan command again.");
      }
      return await handleTrackAction(bot, chatId, trackingId, trackingInfo);
    } else if (actionType === 'details') {
        trackingInfo = lastAnalysisResults[chatId];
        if (!trackingInfo || !trackingInfo.allWalletsDetails || !trackingInfo.tokenInfo) {
            throw new Error("No wallet details or token information found. Please run the analysis again.");
        }

        const { symbol, totalSupply, decimals } = trackingInfo.tokenInfo;
        if (!symbol || totalSupply === undefined || decimals === undefined) {
            throw new Error("Incomplete token information. Please run the analysis again.");
        }
    
        return await sendWalletDetails(bot, chatId, trackingInfo.allWalletsDetails, trackingInfo.tokenInfo);
      } else {
      // For other actions, use pendingTracking
      trackingInfo = pendingTracking.get(trackingId);
      if (!trackingInfo) {
        throw new Error("Tracking info not found. Please start the tracking process again.");
      }
    }

    console.log('Tracking info:', JSON.stringify(trackingInfo, null, 2));

    switch (actionType) {
      case 'sd': // Set Default threshold
        await handleSetDefaultThreshold(bot, chatId, trackingInfo, trackingId);
        break;
      case 'sc': // Set Custom threshold
        await handleSetCustomThreshold(bot, chatId, trackingInfo, trackingId);
        break;
      case 'st': // Start Tracking
        await handleStartTracking(bot, chatId, trackingInfo);
        pendingTracking.delete(trackingId);
        break;
      case 'more': //display more wallets
        if (actionType === 'more' && trackingId === 'wallets') {
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

const handleTrackAction = async (bot, chatId, tokenAddress, analysisResults) => {
  if (!analysisResults) {
    throw new Error("Analysis results not found");
  }

  // Correctly assign tokenAddress from analysisResults if it exists
  tokenAddress = analysisResults.tokenAddress || tokenAddress;

  const totalSupply = analysisResults.tokenInfo?.totalSupply;
  const decimals = analysisResults.tokenInfo?.decimals || 6;
  const ticker = analysisResults.tokenInfo?.symbol || 'Unknown';
  const initialSupplyPercentage = analysisResults.totalSupplyControlled || analysisResults.initialSupplyPercentage || 0;
  const trackType = analysisResults.analysisType === 'tokenScanner' ? 'topHolders' : 'team';
  
  const supplyType = trackType === 'team' ? 'team supply' : 'total supply';
  const message = `🔁 Ready to track ${ticker} ${supplyType} (${initialSupplyPercentage.toFixed(2)}%)\n\n` +
                  `You will receive a notification when ${supplyType} changes by more than 1%`;

  // Generate a short unique identifier for this tracking session
  const trackingId = generateShortId();

  const keyboard = {
    inline_keyboard: [
      [
        { text: "✅1%", callback_data: `sd_${trackingId}` },
        { text: "Custom %", callback_data: `sc_${trackingId}` }
      ],
      [{ text: "Start tracking", callback_data: `st_${trackingId}` }]
    ]
  };

  await bot.sendMessage(chatId, message, { reply_markup: keyboard });

    pendingTracking.set(trackingId, {
        ...analysisResults,
        trackType,
        threshold: 1,
        chatId,
        tokenAddress,
        totalSupply,
        decimals
    });

  console.log(`Stored tracking info for ID ${trackingId}:`, JSON.stringify(pendingTracking.get(trackingId), null, 2));
};

// Helper function to generate a short unique identifier
function generateShortId() {
  return Math.random().toString(36).substr(2, 8);
}

const handleSetDefaultThreshold = async (bot, chatId, trackingInfo, trackingId) => {
  trackingInfo.threshold = 1;
  await bot.sendMessage(chatId, `Threshold set to default (1%)`);
  pendingTracking.set(trackingId, trackingInfo);
};

const handleSetCustomThreshold = async (bot, chatId, trackingInfo, trackingId) => {
  await bot.sendMessage(chatId, "Enter new supply change (ex: 2.5):");
  trackingInfo.awaitingCustomThreshold = true;
  pendingTracking.set(trackingId, trackingInfo);
};

const handleStartTracking = async (bot, chatId, trackingInfo) => {
  console.log('Starting tracking with info:', JSON.stringify(trackingInfo, null, 2));

  const { trackType, tokenAddress, teamWallets, topHoldersWallets, initialSupplyPercentage, totalSupply, threshold, tokenInfo } = trackingInfo;
  
  const wallets = trackType === 'team' ? teamWallets : topHoldersWallets;
  console.log('Wallets for tracking:', JSON.stringify(wallets, null, 2));
  
  if (!wallets || wallets.length === 0) {
    console.warn(`No ${trackType} wallets found for ${tokenAddress}. This may cause issues with tracking.`);
    await bot.sendMessage(chatId, `Warning: No ${trackType} wallets found. Tracking may not work as expected.`);
    return;
  }

  console.log('total supply for' ,tokenAddress, ' is :' ,JSON.stringify(totalSupply, null, 2));

  supplyTrackerInstance.startTracking(
    tokenAddress,
    chatId,
    wallets,
    initialSupplyPercentage,
    totalSupply,
    threshold,
    tokenInfo.symbol,
    tokenInfo.decimals,
    trackType
  );

  await bot.sendMessage(chatId, `Tracking started for ${tokenInfo.symbol} ${trackType} supply with ${threshold}% threshold.`);
};

const handleMessage = async (bot, msg) => {
  const chatId = msg.chat.id;
  const trackingInfo = pendingTracking.get(chatId);
  
  if (trackingInfo && trackingInfo.awaitingCustomThreshold) {
    const threshold = parseFloat(msg.text);
    if (isNaN(threshold) || threshold <= 0 || threshold > 100) {
      await bot.sendMessage(chatId, "Please enter a valid number between 0 and 100 for the threshold.");
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

    await bot.sendMessage(chatId, message, { reply_markup: keyboard });
  }
};

const handleSearchCommand = async (bot, msg, match) => {
  try {
    const input = match[1];
    if (!input) {
      await bot.sendMessage(msg.chat.id, "Please provide a coin address and search criteria. Usage: /search <coin_address> <search_criteria>");
      return;
    }

    const [coinAddress, ...searchCriteria] = input.split(' ');

    if (!coinAddress || searchCriteria.length === 0) {
      await bot.sendMessage(msg.chat.id, "Invalid input. Please provide both a coin address and search criteria.");
      return;
    }

    await bot.sendMessage(msg.chat.id, `Searching wallets for coin: ${coinAddress}`);

    const results = await searchWallets(coinAddress, searchCriteria, 'searchWallet');

    if (results.length === 0) {
      await bot.sendMessage(msg.chat.id, "No matching wallets found.");
      return;
    }

    let message = `Found ${results.length} matching wallet(s):\n\n`;
    message += results.join('');

    await bot.sendLongMessage(msg.chat.id, message, { parse_mode: 'HTML', disable_web_page_preview: true });

  } catch (error) {
    console.error(`Error in handleSearchCommand:`, error);
    await bot.sendMessage(msg.chat.id, `An error occurred during the search: ${error.message}`);
  } finally {
    ApiCallCounter.logApiCalls('searchWallet');
  }

};

module.exports = {
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
  handleMessage
};