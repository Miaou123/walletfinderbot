const unifiedApi = require('../integrations/unifiedApiClient');
const requestManager = require('../utils/requestManager');
const logger = require('../utils/logger');

/**
 * Optimized cross-analyzer for finding common holders between multiple tokens
 */
class CrossAnalyzerOptimized {
  /**
   * Analyzes multiple tokens to find common holders with significant value
   * @param {Array<string>} tokenAddresses - Array of token addresses to analyze
   * @param {number} minHoldingValueUsd - Minimum combined holding value in USD
   * @param {string} mainContext - Context for tracking API calls
   * @param {string} subContext - Sub-context for tracking API calls
   * @returns {Promise<Object>} Analysis results
   */
  async analyzeCrossTokens(tokenAddresses, minHoldingValueUsd = 10000, mainContext = 'crossAnalyzer', subContext = null) {
    if (!Array.isArray(tokenAddresses) || tokenAddresses.length < 2) {
      throw new Error('At least two token addresses are required for cross analysis');
    }

    // Create cache key based on sorted addresses and threshold
    const sortedAddresses = [...tokenAddresses].sort();
    const cacheKey = `cross_analysis_${sortedAddresses.join('_')}_${minHoldingValueUsd}`;
    
    return requestManager.withCache(cacheKey, async () => {
      try {
        // Fetch token info and prices for all tokens in parallel
        const tokenInfoPromises = sortedAddresses.map(address => 
          unifiedApi.getTokenInfo(address, mainContext, subContext)
        );
        
        const tokenInfos = await Promise.all(tokenInfoPromises);
        
        // Map token addresses to their info for easy lookup
        const tokenInfoMap = tokenInfos.reduce((map, info, index) => {
          map[sortedAddresses[index]] = info;
          return map;
        }, {});
        
        // Fetch holder data for all tokens in parallel
        const holderDataPromises = sortedAddresses.map(address => 
          this._getTokenHolders(address, mainContext, subContext)
        );
        
        const holderDataResults = await Promise.all(holderDataPromises);
        
        // Build a wallet map to track holdings across tokens
        const walletMap = this._buildWalletMap(holderDataResults, sortedAddresses, tokenInfoMap);
        
        // Filter wallets that hold multiple tokens and meet value threshold
        const crossWallets = this._filterCrossWallets(walletMap, tokenAddresses.length, minHoldingValueUsd);
        
        // Build final result object
        return {
          tokens: tokenInfos.map(info => ({
            address: info.address,
            symbol: info.symbol,
            name: info.name,
            priceUsd: info.priceUsd
          })),
          commonWallets: crossWallets,
          analyzedAt: new Date().toISOString(),
          stats: {
            totalWallets: Object.keys(walletMap).length,
            crossWallets: crossWallets.length,
            tokenCount: tokenAddresses.length
          }
        };
      } catch (error) {
        logger.error('Error in cross token analysis:', error);
        throw error;
      }
    }, { ttl: requestManager.cacheTimes.long });
  }
  
  /**
   * Get token holders with optimized caching
   * @private
   */
  async _getTokenHolders(tokenAddress, mainContext, subContext) {
    const cacheKey = `token_holders_${tokenAddress}`;
    
    return requestManager.withCache(cacheKey, async () => {
      const holders = await unifiedApi.getTokenHolders(tokenAddress, 100, mainContext, subContext);
      return { tokenAddress, holders };
    }, { ttl: requestManager.cacheTimes.medium });
  }
  
  /**
   * Build a map of wallets and their holdings across tokens
   * @private
   */
  _buildWalletMap(holderDataResults, tokenAddresses, tokenInfoMap) {
    const walletMap = {};
    
    holderDataResults.forEach(({ tokenAddress, holders }) => {
      const tokenInfo = tokenInfoMap[tokenAddress];
      
      if (!holders || !Array.isArray(holders)) {
        logger.warn(`No holder data found for token ${tokenAddress}`);
        return;
      }
      
      holders.forEach(holder => {
        const { address, amount, uiAmount } = holder;
        
        // Skip invalid data
        if (!address || !uiAmount) return;
        
        // Initialize wallet entry if needed
        if (!walletMap[address]) {
          walletMap[address] = {
            address,
            holdings: {},
            tokenCount: 0,
            totalValueUsd: 0
          };
        }
        
        // Calculate holding value if price available
        const priceUsd = tokenInfo?.priceUsd || 0;
        const valueUsd = priceUsd * parseFloat(uiAmount);
        
        // Add holding
        walletMap[address].holdings[tokenAddress] = {
          amount,
          uiAmount: parseFloat(uiAmount),
          valueUsd,
          symbol: tokenInfo?.symbol || 'Unknown'
        };
        
        walletMap[address].tokenCount++;
        walletMap[address].totalValueUsd += valueUsd;
      });
    });
    
    return walletMap;
  }
  
  /**
   * Filter wallets that hold multiple tokens and meet value threshold
   * @private
   */
  _filterCrossWallets(walletMap, totalTokenCount, minHoldingValueUsd) {
    const crossWallets = Object.values(walletMap)
      .filter(wallet => 
        wallet.tokenCount >= 2 && 
        wallet.totalValueUsd >= minHoldingValueUsd
      )
      .sort((a, b) => {
        // Sort by token count first, then by total value
        if (b.tokenCount !== a.tokenCount) {
          return b.tokenCount - a.tokenCount;
        }
        return b.totalValueUsd - a.totalValueUsd;
      })
      .map(wallet => {
        // Format holdings for output
        const tokenHoldings = Object.entries(wallet.holdings).map(([tokenAddress, holding]) => ({
          tokenAddress,
          amount: holding.uiAmount,
          symbol: holding.symbol,
          valueUsd: holding.valueUsd
        }));
        
        return {
          address: wallet.address,
          tokenCount: wallet.tokenCount,
          totalValueUsd: wallet.totalValueUsd,
          coveragePercent: (wallet.tokenCount / totalTokenCount) * 100,
          holdings: tokenHoldings
        };
      });
    
    return crossWallets;
  }
}

module.exports = new CrossAnalyzerOptimized();