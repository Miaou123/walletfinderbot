const { getSolanaApi } = require('../integrations/solanaApi');
const { checkInactivityPeriod } = require('../tools/inactivityPeriod');
const { getAssetsForMultipleWallets } = require('../tools/walletValueCalculator');
const { getTopHolders } = require('../tools/getHolders');
const { fetchMultipleWallets } = require('../tools/walletChecker');
const config = require('../utils/config');
const BigNumber = require('bignumber.js');
const logger = require('../utils/logger');

async function analyzeToken(coinAddress, count, mainContext = 'default') {
  try {
    logger.debug('Fetching token metadata...');
    const solanaApi = getSolanaApi();
    const tokenMetadata = await solanaApi.getAsset(coinAddress, mainContext, 'getAsset');
    
    if (!tokenMetadata) {
      throw new Error("No token metadata found");
    }

    logger.debug('Token metadata received:', tokenMetadata);

    // Adapter les données pour correspondre au format attendu
    const formattedTokenInfo = {
      decimals: tokenMetadata.decimals,
      symbol: tokenMetadata.symbol,
      name: tokenMetadata.name,
      address: coinAddress,
      price: tokenMetadata.price,
      total_supply: tokenMetadata.supply.total,
      // Ces valeurs peuvent être calculées si nécessaire
      market_cap: tokenMetadata.price * tokenMetadata.supply.total,
    };

    const topHolders = await getTopHolders(coinAddress, count, mainContext, 'getTopHolders');
    const walletInfos = topHolders.map(holder => ({ 
      address: holder.address, 
      tokenBalance: holder.amount 
    }));

    const analyzedWallets = await analyzeAndFormatMultipleWallets(
      walletInfos, 
      coinAddress, 
      formattedTokenInfo, 
      mainContext
    );

    return { 
      tokenInfo: formattedTokenInfo, 
      analyzedWallets 
    };

  } catch (error) {
    logger.error('Error analyzing token:', { coinAddress, error: error.message });
    throw error;
  }
}

const analyzeAndFormatMultipleWallets = async (walletInfos, coinAddress, tokenInfo, mainContext) => {
  try {
    const walletAddresses = walletInfos.map(info => info.address);
    const assetsData = await getAssetsForMultipleWallets(walletAddresses, mainContext, 'getAssets');

    return await Promise.all(walletInfos.map(walletInfo => fetchAndFormatWalletData(walletInfo, assetsData, coinAddress, tokenInfo, mainContext)));
  } catch (error) {
    console.error('Error in analyzeAndFormatMultipleWallets:', error);
    throw error;
  }
};

const fetchAndFormatWalletData = async (walletInfo, assetsData, coinAddress, tokenInfo, mainContext) => {
  try {
    let stats = assetsData[walletInfo.address];
    if (!stats) return generateErrorObject(walletInfo.address, 'No data found');

    const specificTokenInfo = stats.tokenInfos.find(t => t.mint === coinAddress);
    const analyzedTokenValue = specificTokenInfo ? parseFloat(specificTokenInfo.value) : 0;
    const walletValueExcludingAnalyzedToken = parseFloat(stats.totalValue) - analyzedTokenValue;

    let isInteresting = false, category = '';

    if (isHighValue(walletValueExcludingAnalyzedToken)) {
      ({ isInteresting, category } = markAsInteresting('High Value'));
    } else {
      const transactionCount = await getTransactionCountIfNeeded(walletInfo.address, stats, mainContext);
      if (isLowTransactionCount(transactionCount)) {
        ({ isInteresting, category } = markAsInteresting('Low Transactions'));
      } else {
        const inactivityCheck = await checkInactivityPeriod(walletInfo.address, coinAddress, mainContext, 'checkInactivity');
        if (inactivityCheck.isInactive) {
          ({ isInteresting, category } = markAsInteresting('Inactive'));
          stats.daysSinceLastRelevantSwap = inactivityCheck.daysSinceLastActivity;
        }
      }
    }

    const { tokenBalance, supplyPercentage, tokenValueUsd, formattedInfo } = formatWalletData(walletInfo, specificTokenInfo, tokenInfo, stats);

    if (isInteresting && category === 'High Value') {
      const walletCheckerData = await fetchMultipleWallets([walletInfo.address], 1, mainContext, 'walletChecker');
      if (walletCheckerData && walletCheckerData[0]) return enrichWalletInfo(walletInfo, walletCheckerData[0], category, stats, formattedInfo, supplyPercentage, tokenValueUsd, tokenBalance, tokenInfo.symbol);
    }

    return generateResultObject(walletInfo.address, isInteresting, category, stats, formattedInfo, supplyPercentage, tokenValueUsd, tokenBalance, tokenInfo.symbol);
  } catch (error) {
    console.error(`Error analyzing wallet ${walletInfo.address}:`, error);
    return generateErrorObject(walletInfo.address, 'Failed to analyze');
  }
};

const isHighValue = (value) => value > config.HIGH_WALLET_VALUE_THRESHOLD;

const markAsInteresting = (category) => ({ isInteresting: true, category });

const getTransactionCountIfNeeded = async (address, stats, mainContext) => {
  const solanaApi = getSolanaApi();
  const transactions = await solanaApi.getSignaturesForAddress(address, { limit: config.LOW_TRANSACTION_THRESHOLD + 1 }, mainContext, 'getSignatures');
  stats.transactionCount = transactions.length;
  return transactions.length;
};

const isLowTransactionCount = (count) => count < config.LOW_TRANSACTION_THRESHOLD;

const formatWalletData = (walletInfo, specificTokenInfo, tokenInfo, stats) => {
  const tokenBalance = specificTokenInfo ? new BigNumber(specificTokenInfo.balance) : new BigNumber(0);
  const supplyPercentage = calculateSupplyPercentage(tokenBalance, tokenInfo.total_supply);
  const tokenValueUsd = specificTokenInfo ? specificTokenInfo.value : 'N/A';
  const formattedInfo = `${tokenBalance.toFormat(0)} ${tokenInfo.symbol}, ${supplyPercentage}% of supply, $${tokenValueUsd} - ${stats.solBalance} SOL - ${stats.daysSinceLastRelevantSwap || 'N/A'} days since last relevant swap`;

  return { tokenBalance, supplyPercentage, tokenValueUsd, formattedInfo };
};

const calculateSupplyPercentage = (balance, totalSupply) => {
  return totalSupply && !isNaN(totalSupply) && totalSupply > 0 ? balance.dividedBy(totalSupply).multipliedBy(100).toFixed(2) : 'N/A';
};

const generateResultObject = (address, isInteresting, category, stats, formattedInfo, supplyPercentage, tokenValueUsd, tokenBalance, tokenSymbol) => ({
  address, isInteresting, category, stats, formattedInfo, supplyPercentage, tokenValueUsd, tokenBalance: tokenBalance.toFormat(0), tokenSymbol, solBalance: stats.solBalance, daysSinceLastRelevantSwap: stats.daysSinceLastRelevantSwap || 'N/A'
});

const generateErrorObject = (address, error) => ({ address, isInteresting: false, error });

const enrichWalletInfo = (walletInfo, walletCheckerData, category, stats, formattedInfo, supplyPercentage, tokenValueUsd, tokenBalance, tokenSymbol) => {
  const { winrate, realized_profit_30d, unrealized_profit } = walletCheckerData.data.data;
  return { address: walletInfo.address, isInteresting: true, category, stats, formattedInfo, supplyPercentage, tokenValueUsd, tokenBalance: tokenBalance.toFormat(0), tokenSymbol, solBalance: stats.solBalance, daysSinceLastRelevantSwap: stats.daysSinceLastRelevantSwap || 'N/A', winrate: winrate * 100, pnl30d: realized_profit_30d, unrealizedPnl: unrealized_profit };
};

module.exports = { analyzeToken, analyzeAndFormatMultipleWallets };
