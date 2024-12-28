const { analyzeTeamSupply } = require('../../analysis/teamSupply');
const { formatTeamSupplyResult, formatWalletDetails } = require('../formatters/teamSupplyFormatter');
const { RequestCache, cachedCommand } = require('../../utils/requestCache');
const logger = require('../../utils/logger');
const stateManager = require('../../utils/stateManager');

class TeamHandler {
 constructor() {
   this.COMMAND_NAME = 'team';
   this.cache = new RequestCache(2 * 60 * 1000);
 }

 async handleCommand(bot, msg, args) {
   const chatId = msg.chat.id;
   const username = msg.from.username;

   try {
     const [tokenAddress] = args;
     if (!tokenAddress) {
       await bot.sendMessage(chatId, "Please provide a token address.");
       return;
     }

     const cacheParams = { tokenAddress };
     const fetchFunction = async () => analyzeTeamSupply(tokenAddress, 'teamSupply');

     const { scanData, trackingInfo } = await cachedCommand(
       this.cache,
       '/teamSupply',
       cacheParams,
       fetchFunction
     );

     const formattedResult = formatTeamSupplyResult(
       scanData.analyzedWallets,
       scanData.tokenInfo,
       scanData.teamWallets,
       scanData.totalSupplyControlled
     );

     const trackingData = this.prepareTrackingData(scanData, tokenAddress, username);
     stateManager.setTrackingInfo(chatId, tokenAddress, trackingData);

     await bot.sendMessage(chatId, formattedResult, {
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
     await bot.sendMessage(chatId, `An error occurred during team supply analysis: ${error.message}`);
   }
 }

 prepareTrackingData(scanData, tokenAddress, username) {
   return {
     tokenAddress,
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
 }

 async handleCallback(bot, query) {
    if (!query.data.startsWith('details_')) return;
  
    const chatId = query.message.chat.id;
    const tokenAddress = query.data.split('_')[1];
    const trackingInfo = stateManager.getTrackingInfo(chatId, tokenAddress);
  
    if (!trackingInfo?.allWalletsDetails) {
      throw new Error("No wallet details found. Please run the analysis again.");
    }
  
    const message = formatWalletDetails(trackingInfo.allWalletsDetails, trackingInfo.tokenInfo);
    await bot.sendLongMessage(chatId, message, { 
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
  
    await bot.answerCallbackQuery(query.id);
  }
}

module.exports = TeamHandler;