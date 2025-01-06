const { getSolanaApi } = require('../integrations/solanaApi');
const { getAssetsForMultipleWallets } = require('../tools/walletValueCalculator');
const { checkInactivityPeriod } = require('../tools/inactivityPeriod');
const { getTopHolders } = require('../tools/getHolders');
const { fetchMultipleWallets } = require('../tools/walletChecker');
const PoolAndBotDetector = require('../tools/poolAndBotDetector');
const config = require('../utils/config');
const BigNumber = require('bignumber.js');
const logger = require('../utils/logger');

async function scanToken(tokenAddress, requestedHolders = 10, trackSupply = false, mainContext = 'default') {
  logger.debug(`Starting scan for token ${tokenAddress}`, { requestedHolders, trackSupply, mainContext });

  let tokenInfo;
  try {
    logger.debug('Fetching token info from Helius...');
    const solanaApi = getSolanaApi();
    const assetInfo = await solanaApi.getAsset(tokenAddress, mainContext, 'scanToken');
    
    if (!assetInfo) {
      throw new Error("No token info found");
    }

    tokenInfo = {
      decimals: assetInfo.decimals,
      symbol: assetInfo.symbol,
      name: assetInfo.name,
      price: assetInfo.price,
      total_supply: assetInfo.supply.total
    };

    logger.debug('Token info received:', tokenInfo);
  } catch (error) {
    logger.error('Error fetching token info:', error);
    throw error;
  }

  const topHolders = await getTopHolders(tokenAddress, 20, mainContext, 'getTopHolders');
  const walletAddresses = topHolders.map(holder => holder.address);
  const assetsData = await getAssetsForMultipleWallets(walletAddresses, mainContext, 'getAssets');

  const detector = new PoolAndBotDetector();
  
  const analyzedWallets = await Promise.all(topHolders.map(async (holder, index) => {
    try {
      const walletData = assetsData[holder.address] || {};
      const decimals = tokenInfo.decimals;
      const totalSupply = new BigNumber(tokenInfo.total_supply || 0);
      const tokenBalanceRaw = new BigNumber(holder.tokenBalance || 0);
      const tokenBalance = tokenBalanceRaw.dividedBy(new BigNumber(10).pow(decimals));
      const supplyPercentage = totalSupply.isGreaterThan(0) ? 
        tokenBalance.dividedBy(totalSupply).multipliedBy(100).toFixed(2) : '0';

      const analyzedTokenInfo = walletData.tokenInfos && walletData.tokenInfos.find(t => t.mint === tokenAddress) || {};
      const tokenValue = new BigNumber(analyzedTokenInfo.value || 0);
      const totalValue = new BigNumber(walletData.totalValue || 0);
      const portfolioValueWithoutToken = totalValue.minus(tokenValue);

      const walletAnalysis = await detector.analyzeWallet({
        wallet: holder.address,
        data: { data: walletData }
      }, mainContext);

      let isInteresting = false;
      let category = '';

      if (walletAnalysis.type === 'pool' || walletAnalysis.type === 'bot') {
        isInteresting = false;
        category = walletAnalysis.type === 'bot' ? 'Bot' : 'Pool';
      } else {
        if (portfolioValueWithoutToken.isGreaterThan(config.HIGH_WALLET_VALUE_THRESHOLD)) {
          isInteresting = true;
          category = 'High Value';
        } else {
          const solanaApi = getSolanaApi();
          const transactions = await solanaApi.getSignaturesForAddress(holder.address, { limit: config.LOW_TRANSACTION_THRESHOLD }, mainContext);
          const transactionCount = transactions.length;

          if (transactionCount < config.LOW_TRANSACTION_THRESHOLD) {
            isInteresting = true;
            category = 'Fresh Address';
          } else {
            const inactivityCheck = await checkInactivityPeriod(holder.address, tokenAddress, mainContext, 'checkInactivity');
            if (inactivityCheck.isInactive) {
              isInteresting = true;
              category = 'Inactive';
            }
          }
        }
      }

      return {
        rank: index + 1,
        address: holder.address,
        supplyPercentage,
        solBalance: walletData.solBalance || '0',
        portfolioValue: walletData.totalValue || '0',
        portfolioValueWithoutToken: portfolioValueWithoutToken.toFixed(2),
        isInteresting,
        category,
        walletType: walletAnalysis.type,
        poolType: walletAnalysis.subType,
        tokenBalance: tokenBalance.toFormat(0),
        tokenValue: tokenValue.toFixed(2),
        tokenInfos: walletData.tokenInfos || []
      };
    } catch (error) {
      logger.error(`Error analyzing wallet ${holder.address}:`, error);
      return {
        rank: index + 1,
        address: holder.address,
        error: 'Failed to analyze'
      };
    }
  }));

  const filteredWallets = analyzedWallets
    .filter(wallet => {
      if (wallet.error) return false;
      if (wallet.walletType === 'pool') return false;
      return new BigNumber(wallet.portfolioValue).isGreaterThan(0);
    })
    .slice(0, 10);

  logger.debug(`Wallet filtering results for ${tokenAddress}:`, {
    totalAnalyzed: analyzedWallets.length,
    nonPoolWallets: analyzedWallets.filter(w => w.walletType !== 'pool').length,
    finalWallets: filteredWallets.length
  });

  if (filteredWallets.length > 0) {
    try {
      await fetchMultipleWallets(filteredWallets.map(w => w.address), 5, mainContext, 'scanToken');
    } catch (error) {
      logger.error(`Error processing wallets with walletChecker: ${error.message}`);
    }
  }

  const totalSupplyControlled = filteredWallets.reduce((sum, wallet) => 
    sum + parseFloat(wallet.supplyPercentage || 0), 0);

  const averagePortfolioValue = filteredWallets.length > 0 
    ? filteredWallets.reduce((sum, wallet) => sum + parseFloat(wallet.portfolioValue || 0), 0) / filteredWallets.length
    : 0;
  const notableAddresses = filteredWallets.filter(wallet => wallet.isInteresting).length;

  const scanData = {
    tokenInfo,
    filteredWallets,
    totalSupplyControlled,
    averagePortfolioValue,
    notableAddresses,
    tokenAddress
  };

  if (trackSupply) {
    logger.debug('Preparing tracking info:', {
      tokenAddress,
      symbol: tokenInfo.symbol,
      totalSupply: tokenInfo.total_supply,
      decimals: tokenInfo.decimals,
      totalSupplyControlled,
      holdersCount: filteredWallets.length
    });

    return {
      scanData,
      trackingInfo: {
        tokenAddress,
        tokenSymbol: tokenInfo.symbol,
        totalSupply: tokenInfo.total_supply,
        decimals: tokenInfo.decimals,
        totalSupplyControlled,
        topHoldersWallets: filteredWallets.map(wallet => ({
          address: wallet.address,
          percentage: parseFloat(wallet.supplyPercentage || 0)
        }))
      }
    };
  }

  return scanData;
}

module.exports = { scanToken };