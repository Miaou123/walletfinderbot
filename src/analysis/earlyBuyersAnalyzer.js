// earlyBuyersAnalyzer.js
const { fetchMultipleWallets } = require('../tools/walletChecker');
const definedApi = require('../integrations/definedApi');
const pumpfunApi = require('../integrations/pumpfunApi');
const logger = require('../utils/logger');
const PoolAndBotDetector  = require('../tools/poolAndBotDetector');
const dexscreenerApi = require('../integrations/dexScreenerApi');


class EarlyBuyersAnalyzer {
   constructor() {
       this.detector = new PoolAndBotDetector();
   }

   processPumpfunTransactions(transactions, walletsData) {
       logger.debug(`Processing ${transactions.length} Pumpfun transactions`);
       
       for (const tx of transactions) {
           const wallet = tx.user;
           const tokenAmount = tx.token_amount;
           const solAmount = tx.sol_amount;
           this.updateWalletData(walletsData, wallet, tokenAmount, solAmount, tx.is_buy, 'pumpfun', tx.signature, tx.timestamp);
       }
       logger.debug(`Finished processing Pumpfun transactions, total wallets tracked: ${walletsData.size}`);
   }

   processDefinedEvents(events, walletsData, endTimestamp) {
       logger.debug(`Starting to process ${events.items.length} Defined events up to timestamp ${endTimestamp}`);
       
       for (const event of events.items) {
           
           if (event.timestamp > endTimestamp) {
               logger.debug(`Event timestamp ${event.timestamp} exceeds limit ${endTimestamp}, stopping processing`);
               return false;
           }
   
           const wallet = event.maker;
           const data = event.data;
       
           if (!data || data.__typename !== 'SwapEventData') {
               logger.warn(`No SwapEventData found for event: ${event.transactionHash}`);
               continue;
           }
   
           let tokenAmount, solAmount;
           const isBuy = event.eventDisplayType === 'Buy';
   
           if (isBuy) {
               tokenAmount = Math.abs(parseFloat(data.amount1));
               solAmount = Math.abs(parseFloat(data.amount0));
           } else {
               tokenAmount = Math.abs(parseFloat(data.amount1));
               solAmount = Math.abs(parseFloat(data.amount0));
           }
   
           this.updateWalletData(walletsData, wallet, tokenAmount, solAmount, isBuy, null, event.transactionHash, event.timestamp);
       }
       logger.debug(`Finished processing batch of Defined events, current wallet count: ${walletsData.size}`);
       return true;
   }

   updateWalletData(walletsData, wallet, tokenAmount, solAmount, isBuy, dex, signature, timestamp) {

       const currentData = walletsData.get(wallet) || {
           wallet,
           bought_amount_token: 0,
           sold_amount_token: 0,
           bought_amount_sol: 0,
           sold_amount_sol: 0,
           dex: dex,
           transactions: []
       };

   
       if (isBuy) {
           currentData.bought_amount_token += tokenAmount;
           currentData.bought_amount_sol += solAmount;
       } else {
           currentData.sold_amount_token += tokenAmount;
           currentData.sold_amount_sol += solAmount;
       }
   
       currentData.transactions.push({
           signature,
           tokenAmount,
           solAmount,
           timestamp: new Date(timestamp * 1000).toISOString(),
           is_buy: isBuy,
           dex
       });
   
       walletsData.set(wallet, currentData);
   }

   async analyzeEarlyBuyers(coinAddress, minPercentage, timeFrameHours, tokenInfo, mainContext = 'default', pumpFlag = '') {
       try {
           logger.debug(`Starting analysis for ${coinAddress} - minPercentage: ${minPercentage}, timeFrameHours: ${timeFrameHours}`);
           logger.debug(`Token info - decimals: ${tokenInfo.decimals}, totalSupply: ${tokenInfo.supply.total}`);

           const walletsData = new Map();
           const isPumpfunToken = coinAddress.endsWith('pump');
   
           const tokenDecimals = tokenInfo.decimals || 6;
           const solDecimals = 9;
           const totalSupply = parseFloat(tokenInfo.supply.total);
           const solPrice = await dexscreenerApi.getSolPrice();
   
           const thresholdAmount = (totalSupply * minPercentage / 100) * Math.pow(10, tokenDecimals);
           logger.debug(`Calculated threshold amount: ${thresholdAmount}`);
   
           let creationTimestamp, endTimestamp;
   
           if (pumpFlag === 'pump' && !isPumpfunToken) {
               throw new Error("This token is not a pumpfun token. If you want to use the 'pump' flag please use a pumpfun token.");
           }
   
           if (isPumpfunToken && (pumpFlag === 'pump' || pumpFlag === '')) {
               logger.debug(`Starting Pumpfun analysis for ${coinAddress}`);
               let offset = 0;
               const limit = 200;
               let hasMoreTransactions = true;
               const allTransactions = [];
   
               while (hasMoreTransactions) {
                   const transactions = await pumpfunApi.getAllTrades(
                       coinAddress,
                       limit,
                       offset,
                       pumpFlag === 'pump' ? 0 : timeFrameHours * 3600,
                       mainContext,
                       'getAllTrades'
                   );
   
                   if (transactions && transactions.length > 0) {
                       allTransactions.push(...transactions);
                       logger.debug(`Pumpfun transactions fetched so far: ${allTransactions.length}`);
                       offset += limit;
                   } else {
                       hasMoreTransactions = false;
                       logger.debug('No more Pumpfun transactions available');
                   }
               }
   
               if (allTransactions.length === 0) {
                   logger.warn('No Pumpfun transactions found');
                   if (pumpFlag === 'pump') {
                       return { earlyBuyers: [], tokenInfo };
                   }
               } else {
                   this.processPumpfunTransactions(allTransactions, walletsData);
                   creationTimestamp = allTransactions[allTransactions.length - 1].timestamp;
                   logger.debug(`Pumpfun analysis complete - Creation timestamp: ${creationTimestamp}`);
               }
           }
   
           if (pumpFlag !== 'pump') {
               logger.debug(`Starting Defined analysis for ${coinAddress}`);
               
               try {
                   const tokenInfo = await dexscreenerApi.getTokenInfo(coinAddress, mainContext, 'getTokenInfo');
                   creationTimestamp = Math.floor(tokenInfo.pairData.pairCreatedAt / 1000);
                   endTimestamp = creationTimestamp + (timeFrameHours * 3600);
                   logger.debug(`Token creation: ${creationTimestamp}, Analysis end: ${endTimestamp}`);

                   if (!creationTimestamp || isNaN(creationTimestamp)) {
                       logger.warn('Invalid creation timestamp from DexScreener');
                       return { earlyBuyers: [], tokenInfo };
                   }
           
                   let cursor = null;
                   let hasMoreEvents = true;
                   const limitEvents = 100;
                   let totalProcessedEvents = 0;
           
                   while (hasMoreEvents) {
                       logger.debug(`Fetching Defined events batch with cursor: ${cursor}`);
                       try {
                           const eventsResponse = await definedApi.getTokenEvents(
                               coinAddress,
                               creationTimestamp,
                               endTimestamp,
                               cursor,
                               limitEvents,
                               mainContext,
                               'getTokenEvents',
                               {
                                   eventDisplayType: ["Buy", "Sell"],
                                   direction: "ASC",
                                   timestamp: {
                                       from: creationTimestamp,
                                       to: endTimestamp
                                   }
                               }
                           );
                                    
                           const events = eventsResponse.data.getTokenEvents;
                           
                           if (!events || !events.items || events.items.length === 0) {
                               logger.debug("No more Defined events available");
                               break;
                           }

                           totalProcessedEvents += events.items.length;
                           logger.debug(`Processing batch of ${events.items.length} events (Total: ${totalProcessedEvents})`);
       
                           hasMoreEvents = this.processDefinedEvents(events, walletsData, endTimestamp);
                           cursor = events.cursor;
                           hasMoreEvents = hasMoreEvents && cursor !== null && events.items.length === limitEvents;
                           
                           logger.debug(`Updated wallet count: ${walletsData.size}, Continue fetching: ${hasMoreEvents}`);
                       } catch (error) {
                           logger.error('Defined API error:', error);
                           break;
                       }
                   }

                   logger.debug(`Defined analysis complete - Total events processed: ${totalProcessedEvents}`);
               } catch (error) {
                   logger.warn('DexScreener error:', error);
                   return { earlyBuyers: [], tokenInfo };
               }
           }

           logger.debug(`Starting wallet filtering - Total wallets: ${walletsData.size}`);
           logger.debug(`Filtering threshold: ${thresholdAmount}`);
   
           const qualifiedWallets = new Map(
               Array.from(walletsData.entries()).filter(([wallet, data]) => {
                   if (typeof data.bought_amount_token !== 'number' || isNaN(data.bought_amount_token)) {
                       logger.warn(`Invalid amount for ${wallet}: ${data.bought_amount_token}`);
                       return false;
                   }
                   const isQualified = data.bought_amount_token >= thresholdAmount;
                   logger.debug(`Wallet ${wallet} qualification - Amount: ${data.bought_amount_token}, Threshold: ${thresholdAmount}, Qualified: ${isQualified}`);
                   return isQualified;
               })
           );
   
           logger.debug(`Qualified wallets: ${qualifiedWallets.size} / ${walletsData.size}`);

           const qualifiedWalletsArray = Array.from(qualifiedWallets.entries());
           const batchSize = 10;
           const filteredEarlyBuyers = [];
   
           for (let i = 0; i < qualifiedWalletsArray.length; i += batchSize) {
               const batch = qualifiedWalletsArray.slice(i, i + batchSize);
               const walletAddresses = batch.map(([wallet]) => wallet);
               
               logger.debug(`Processing wallet batch ${i/batchSize + 1}: ${walletAddresses.join(', ')}`);
               
               try {
                   const walletAnalysisBatch = await fetchMultipleWallets(walletAddresses, 5, mainContext, 'fetchEarlyBuyers');
                   const analysisTasks = walletAnalysisBatch.map(async walletData => {
                       if (walletData?.data) {
                           return this.detector.analyzeWallet({
                               wallet: walletData.wallet,
                               data: walletData.data
                           }, mainContext);
                       }
                       return null;
                   });
   
                   const analysisResults = await Promise.all(analysisTasks);
   
                   analysisResults.forEach((analysis, index) => {
                       if (analysis && analysis.type === 'normal') {
                           const [wallet, data] = batch[index];
                           const walletData = walletAnalysisBatch[index];
   
                           const adjustedBoughtToken = data.bought_amount_token * Math.pow(10, -tokenDecimals);
                           const adjustedSoldToken = data.sold_amount_token * Math.pow(10, -tokenDecimals);
                           const adjustedBoughtSol = data.bought_amount_sol * Math.pow(10, -solDecimals);
                           const adjustedSoldSol = data.sold_amount_sol * Math.pow(10, -solDecimals);
                           const buyAmountUsd = adjustedBoughtSol * solPrice;
                           const sellAmountUsd = adjustedSoldSol * solPrice;

                           logger.debug(`Adding filtered buyer ${wallet}:
                               Tokens - Bought: ${adjustedBoughtToken}, Sold: ${adjustedSoldToken}
                               SOL - Bought: ${adjustedBoughtSol}, Sold: ${adjustedSoldSol}
                               USD - Bought: ${buyAmountUsd}, Sold: ${sellAmountUsd}`);
   
                           filteredEarlyBuyers.push({
                               wallet,
                               bought_amount_token: adjustedBoughtToken,
                               sold_amount_token: adjustedSoldToken,
                               bought_amount_sol: adjustedBoughtSol,
                               sold_amount_sol: adjustedSoldSol,
                               bought_amount_usd: buyAmountUsd,
                               sold_amount_usd: sellAmountUsd,
                               dex: data.dex || null,
                               walletInfo: walletData.data.data
                           });
                       } else if (analysis) {
                           logger.debug(`Excluded wallet ${batch[index][0]} - Type: ${analysis.type}`);
                       }
                   });
               } catch (error) {
                   logger.error(`Wallet batch analysis error:`, error);
               }
           }
       
           logger.debug(`Analysis complete - Found ${filteredEarlyBuyers.length} early buyers`);
       
           const result = {
               earlyBuyers: filteredEarlyBuyers,
               tokenInfo,
               solPrice
           };
           return result;
   
       } catch (error) {
           logger.error(`Analysis failed for ${coinAddress}:`, error);
           throw error;
       }
   }
}

module.exports = EarlyBuyersAnalyzer;