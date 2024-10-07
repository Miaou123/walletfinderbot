const { getSolanaApi } = require('../integrations/solanaApi');
const dexScreenerApi = require('../integrations/dexScreenerApi');
const { checkInactivityPeriod } = require('../tools/inactivityPeriod');
const { getAssetsForMultipleWallets } = require('../tools/walletValueCalculator');
const { getHolders, getTopHolders } = require('../tools/getHolders');
const { fetchMultipleWallets } = require('../tools/walletChecker');
const config = require('../config/config');
const BigNumber = require('bignumber.js');

async function analyzeToken(coinAddress, count, mainContext = 'default') {

  // Fetch token info
  const tokenInfo = await dexScreenerApi.getTokenInfo(coinAddress, mainContext);
  if (!tokenInfo) {
    throw new Error("Failed to fetch token information");
  }

  // Get top holders
  console.log(`Calling getTopHolders with count: ${count}`);
  const topHolders = await getTopHolders(coinAddress, count, mainContext, 'getTopHolders');
  
  const walletInfos = topHolders.map(holder => ({
    address: holder.address,
    tokenBalance: holder.amount
  }));

  // Analyze wallets
  const analyzedWallets = await analyzeAndFormatMultipleWallets(walletInfos, coinAddress, tokenInfo, mainContext);

  return {
    tokenInfo,
    analyzedWallets
  };
}

const analyzeAndFormatMultipleWallets = async (walletInfos, coinAddress, tokenInfo, mainContext) => {
  try {
    console.log(`Analyzing ${walletInfos.length} wallets`);
    const walletAddresses = walletInfos.map(info => info.address);
    const assetsData = await getAssetsForMultipleWallets(walletAddresses, mainContext, 'getAssets');

    const analyzedWallets = await Promise.all(walletInfos.map(async (walletInfo) => {
      try {
        console.log(`Processing wallet ${walletInfo.address}`);
        let stats = assetsData[walletInfo.address];
        if (!stats) {
          console.error(`No data found for wallet ${walletInfo.address}`);
          return {
            address: walletInfo.address,
            isInteresting: false,
            error: 'No data found'
          };
        }

        // Find the specific token in tokenInfos
        const specificTokenInfo = stats.tokenInfos.find(t => t.mint === coinAddress);

        let isInteresting = false;
        let category = '';

        // Calculate wallet value excluding the analyzed token
        const analyzedTokenValue = specificTokenInfo ? parseFloat(specificTokenInfo.value) : 0;
        const walletValueExcludingAnalyzedToken = parseFloat(stats.totalValue) - analyzedTokenValue;

        console.log(`Wallet ${walletInfo.address} total value: $${stats.totalValue}`);
        console.log(`Wallet ${walletInfo.address} value excluding analyzed token: $${walletValueExcludingAnalyzedToken}`);

        // Check if the wallet is high value based on the adjusted value
        if (walletValueExcludingAnalyzedToken > config.HIGH_WALLET_VALUE_THRESHOLD) {
          console.log(`Wallet ${walletInfo.address} has high adjusted value: $${walletValueExcludingAnalyzedToken}`);
          isInteresting = true;
          category = 'High Value';
        }
        // 2. Check Low Transactions only if not already interesting
        if (!isInteresting) {
          const solanaApi = getSolanaApi();
          const transactions = await solanaApi.getSignaturesForAddress(walletInfo.address, { limit: config.LOW_TRANSACTION_THRESHOLD + 1 }, mainContext, 'getSignatures');
          const transactionCount = transactions.length;
          stats.transactionCount = transactionCount;
          console.log(`Wallet ${walletInfo.address} transaction count: ${transactionCount}`);

          if (transactionCount < config.LOW_TRANSACTION_THRESHOLD) {
            isInteresting = true;
            category = 'Low Transactions';
          }
        }

        // 3. Check Inactivity only if not already interesting
        if (!isInteresting) {
          const inactivityCheck = await checkInactivityPeriod(walletInfo.address, coinAddress, mainContext, 'checkInactivity');
          stats.daysSinceLastRelevantSwap = inactivityCheck.daysSinceLastActivity;

          if (inactivityCheck.isInactive) {
            isInteresting = true;
            category = 'Inactive';
          }
        }

     // Handle specific token balance and formatting
     const tokenBalance = specificTokenInfo ? new BigNumber(specificTokenInfo.balance) : new BigNumber(0);
     console.log(`Raw token balance for ${walletInfo.address}: ${tokenBalance.toString()}`);

     let supplyPercentage = 'N/A';
     if (tokenInfo.totalSupply && !isNaN(tokenInfo.totalSupply) && tokenInfo.totalSupply > 0) {
       supplyPercentage = tokenBalance.dividedBy(tokenInfo.totalSupply).multipliedBy(100).toFixed(2);
       console.log(`Supply percentage for ${walletInfo.address}: ${supplyPercentage}%`);
     } else {
       console.log('Unable to calculate supply percentage. Token info:', tokenInfo);
     }

     let tokenValueUsd = specificTokenInfo ? specificTokenInfo.value : 'N/A';
     console.log(`Token value in USD for ${walletInfo.address}: $${tokenValueUsd}`);

     const formattedInfo = `${tokenBalance.toFormat(0)} ${tokenInfo.symbol}, ` +
                           `${supplyPercentage}% of supply, $${tokenValueUsd} - ` +
                           `${stats.solBalance} SOL - ` +
                           `${stats.daysSinceLastRelevantSwap || 'N/A'} days since last relevant swap`;

      if (isInteresting && category === 'High Value') {
        const walletCheckerData = await fetchMultipleWallets([walletInfo.address], 1, mainContext, 'walletChecker');
        if (walletCheckerData && walletCheckerData[0]) {
          const { winrate, realized_profit_30d, unrealized_profit } = walletCheckerData[0].data.data;
          return {
            address: walletInfo.address,
            isInteresting,
            category,
            stats,
            formattedInfo,
            supplyPercentage,
            tokenValueUsd,
            tokenBalance: tokenBalance.toFormat(0),
            tokenSymbol: tokenInfo.symbol,
            solBalance: stats.solBalance,
            daysSinceLastRelevantSwap: stats.daysSinceLastRelevantSwap || 'N/A',
            winrate: winrate * 100,
            pnl30d: realized_profit_30d,
            unrealizedPnl: unrealized_profit
          };
        }
      }

     return {
       address: walletInfo.address,
       isInteresting,
       category,
       stats,
       formattedInfo,
       supplyPercentage,
       tokenValueUsd,
       tokenBalance: tokenBalance.toFormat(0),
       tokenSymbol: tokenInfo.symbol,
       solBalance: stats.solBalance,
       daysSinceLastRelevantSwap: stats.daysSinceLastRelevantSwap || 'N/A',
     };
   } catch (error) {
     console.error(`Error analyzing wallet ${walletInfo.address}:`, error);
     return {
       address: walletInfo.address,
       isInteresting: false,
       error: 'Failed to analyze'
     };
   }
 }));

 return analyzedWallets;
} catch (error) {
 console.error('Error in analyzeAndFormatMultipleWallets:', error);
 throw error;
}
};

module.exports = { analyzeToken, analyzeAndFormatMultipleWallets };