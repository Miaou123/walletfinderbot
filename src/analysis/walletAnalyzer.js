const { getSolanaApi } = require('../integrations/solanaApi');
const { getDexScreenerApi } = require('../integrations/dexscreenerApi');
const { checkInactivityPeriod } = require('../tools/inactivityPeriod');
const { rateLimitedAxios } = require('../utils/rateLimiter');
const { getAssetsForMultipleWallets } = require('../tools/walletValueCalculator');
const { getHolders, getTopHolders } = require('../tools/getHolders');
const config = require('../utils/config');
const BigNumber = require('bignumber.js');

async function analyzeToken(coinAddress, count) {
  const dexScreenerApi = getDexScreenerApi();

  // Fetch token info
  const tokenInfo = await dexScreenerApi.getTokenInfo(coinAddress);
  if (!tokenInfo) {
    throw new Error("Failed to fetch token information");
  }
  console.log('Token Info:', JSON.stringify(tokenInfo, null, 2));

  // Get top holders
  const topHolders = await getTopHolders(coinAddress, count);
  console.log('Top holders:', JSON.stringify(topHolders, null, 2));
  
  const walletInfos = topHolders.map(holder => ({
    address: holder.address,
    tokenBalance: holder.amount
  }));

  console.log('Wallet infos before analysis:', JSON.stringify(walletInfos, null, 2));
  // Analyze wallets
  const analyzedWallets = await analyzeAndFormatMultipleWallets(walletInfos, coinAddress, tokenInfo);

  return {
    tokenInfo,
    analyzedWallets
  };
}

const analyzeAndFormatMultipleWallets = async (walletInfos, coinAddress, tokenInfo) => {
  try {
    console.log(`Analyzing ${walletInfos.length} wallets`);
    const walletAddresses = walletInfos.map(info => info.address);
    const assetsData = await getAssetsForMultipleWallets(walletAddresses);

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
        //console.log('Specific token info:', JSON.stringify(specificTokenInfo, null, 2));

        let isInteresting = false;
        let category = '';

        // 1. Check SOL Balance
        if (parseFloat(stats.solBalance) >= config.MIN_SOL_BALANCE_FOR_ANALYSIS) {
          console.log(`Wallet ${walletInfo.address} SOL balance: ${stats.solBalance} SOL`);
          console.log(`Wallet ${walletInfo.address} total value: $${stats.totalValue}`);

          if (parseFloat(stats.totalValue) > config.HIGH_WALLET_VALUE_THRESHOLD) {
            console.log(`Wallet ${walletInfo.address} has high total value: $${stats.totalValue}`);
            isInteresting = true;
            category = 'High Value';
          }
        }
        // 2. Check Low Transactions only if not already interesting
        if (!isInteresting) {
          const solanaApi = getSolanaApi();
          const transactions = await solanaApi.getSignaturesForAddress(walletInfo.address, { limit: config.LOW_TRANSACTION_THRESHOLD + 1 });
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
          const inactivityCheck = await checkInactivityPeriod(walletInfo.address, coinAddress);
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