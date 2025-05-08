const gmgnApi = require('./gmgnApi');
const dexScreenerApi = require('./dexScreenerApi');
const definedApi = require('./definedApi');
const pumpfunApi = require('./pumpfunApi');
const { getSolanaApi } = require('./solanaApi');
const logger = require('../utils/logger');
const NodeCache = require('node-cache');

/**
 * UnifiedApiClient - A centralized client for all API interactions
 * Provides caching, error handling, and consistent access to all APIs
 */
class UnifiedApiClient {
  constructor() {
    // Initialize cache with TTL of 5 minutes by default
    this.cache = new NodeCache({
      stdTTL: 300, // 5 minutes
      checkperiod: 60, // Check for expired keys every 60 seconds
    });
    
    // Connect to all API services
    this.gmgn = gmgnApi;
    this.dexScreener = dexScreenerApi;
    this.defined = definedApi;
    this.pumpfun = pumpfunApi;
    this.solana = getSolanaApi();
    
    // API cache times in seconds
    this.cacheTimes = {
      tokenInfo: 120,          // 2 minutes
      tokenHolders: 300,       // 5 minutes
      walletData: 600,         // 10 minutes
      transactions: 120,       // 2 minutes
      prices: 60,              // 1 minute
      tokenSupply: 300,        // 5 minutes
      marketData: 60,          // 1 minute
      solPrice: 30             // 30 seconds
    };
  }

  /**
   * Gets token information from multiple sources and combines them
   * @param {string} tokenAddress - The token contract address
   * @param {string} mainContext - Context for tracking API calls
   * @param {string} subContext - Sub-context for tracking API calls
   * @returns {Promise<Object>} Combined token information
   */
  async getTokenInfo(tokenAddress, mainContext = 'default', subContext = null) {
    const cacheKey = `token_info_${tokenAddress}`;
    
    // Try to get from cache first
    const cachedData = this.cache.get(cacheKey);
    if (cachedData) {
      logger.debug(`Cache hit for token info: ${tokenAddress}`);
      return cachedData;
    }
    
    try {
      // Run API calls in parallel
      const [gmgnData, dexScreenerData, supplyData] = await Promise.allSettled([
        this.gmgn.getTokenInfo(tokenAddress, mainContext, subContext),
        this.dexScreener.getTokenInfo(tokenAddress, mainContext, subContext),
        this.solana.getTokenSupply(tokenAddress)
      ]);
      
      // Combine data from different sources
      const combinedData = this._combineTokenInfo(
        tokenAddress, 
        gmgnData.status === 'fulfilled' ? gmgnData.value : null,
        dexScreenerData.status === 'fulfilled' ? dexScreenerData.value : null,
        supplyData.status === 'fulfilled' ? supplyData.value : null
      );
      
      // Cache the result
      this.cache.set(cacheKey, combinedData, this.cacheTimes.tokenInfo);
      
      return combinedData;
    } catch (error) {
      logger.error(`Error getting token info for ${tokenAddress}:`, error);
      throw error;
    }
  }

  /**
   * Gets token holders data (combines GMGN and on-chain data)
   * @param {string} tokenAddress - The token contract address
   * @param {number} limit - Number of holders to fetch
   * @param {string} mainContext - Context for tracking API calls
   * @param {string} subContext - Sub-context for tracking API calls
   * @returns {Promise<Array>} List of token holders with details
   */
  async getTokenHolders(tokenAddress, limit = 100, mainContext = 'default', subContext = null) {
    const cacheKey = `token_holders_${tokenAddress}_${limit}`;
    
    // Try to get from cache first
    const cachedData = this.cache.get(cacheKey);
    if (cachedData) {
      logger.debug(`Cache hit for token holders: ${tokenAddress}`);
      return cachedData;
    }
    
    try {
      // Get holder data from different sources in parallel
      const [onChainHolders, gmgnTopBuyers, gmgnTopTraders] = await Promise.allSettled([
        this.solana.getTokenHolders(tokenAddress, limit),
        this.gmgn.getTopBuyers ? this.gmgn.getTopBuyers(tokenAddress, mainContext, subContext) : Promise.resolve(null),
        this.gmgn.getTopTraders(tokenAddress, mainContext, subContext)
      ]);
      
      // Combine and enrich holder data
      const combinedHolders = this._combineHolderData(
        onChainHolders.status === 'fulfilled' ? onChainHolders.value?.holders : [],
        gmgnTopBuyers.status === 'fulfilled' ? gmgnTopBuyers.value?.data : [],
        gmgnTopTraders.status === 'fulfilled' ? gmgnTopTraders.value?.data : []
      );
      
      // Cache the result
      this.cache.set(cacheKey, combinedHolders, this.cacheTimes.tokenHolders);
      
      return combinedHolders;
    } catch (error) {
      logger.error(`Error getting token holders for ${tokenAddress}:`, error);
      throw error;
    }
  }

  /**
   * Gets wallet data with portfolio and trading history
   * @param {string} walletAddress - The wallet address
   * @param {string} period - Time period (30d, 7d, etc.)
   * @param {string} mainContext - Context for tracking API calls
   * @param {string} subContext - Sub-context for tracking API calls
   * @returns {Promise<Object>} Wallet data and statistics
   */
  async getWalletData(walletAddress, period = '30d', mainContext = 'default', subContext = null) {
    const cacheKey = `wallet_data_${walletAddress}_${period}`;
    
    // Try to get from cache first
    const cachedData = this.cache.get(cacheKey);
    if (cachedData) {
      logger.debug(`Cache hit for wallet data: ${walletAddress}`);
      return cachedData;
    }
    
    try {
      const [walletInfo, solBalance] = await Promise.allSettled([
        this.gmgn.getWalletData(walletAddress, period, mainContext, subContext),
        this.solana.getBalance(walletAddress)
      ]);
      
      // Combine and format data
      const combinedData = {
        wallet: walletAddress,
        data: walletInfo.status === 'fulfilled' ? walletInfo.value?.data : {},
        solBalance: solBalance.status === 'fulfilled' ? solBalance.value : 0
      };
      
      // Cache the result
      this.cache.set(cacheKey, combinedData, this.cacheTimes.walletData);
      
      return combinedData;
    } catch (error) {
      logger.error(`Error getting wallet data for ${walletAddress}:`, error);
      throw error;
    }
  }

  /**
   * Gets current SOL price
   * @param {string} mainContext - Context for tracking API calls
   * @param {string} subContext - Sub-context for tracking API calls
   * @returns {Promise<number>} Current SOL price in USD
   */
  async getSolPrice(mainContext = 'default', subContext = null) {
    const cacheKey = 'sol_price';
    
    // Try to get from cache first
    const cachedPrice = this.cache.get(cacheKey);
    if (cachedPrice) {
      return cachedPrice;
    }
    
    try {
      const price = await this.dexScreener.getSolPrice(mainContext, subContext);
      
      // Cache the result
      this.cache.set(cacheKey, price, this.cacheTimes.solPrice);
      
      return price;
    } catch (error) {
      logger.error(`Error getting SOL price:`, error);
      throw error;
    }
  }

  /**
   * Gets prices for multiple tokens
   * @param {Array<string>} tokenAddresses - List of token addresses
   * @param {string} mainContext - Context for tracking API calls
   * @param {string} subContext - Sub-context for tracking API calls
   * @returns {Promise<Object>} Map of token addresses to prices
   */
  async getMultipleTokenPrices(tokenAddresses, mainContext = 'default', subContext = null) {
    if (!Array.isArray(tokenAddresses) || tokenAddresses.length === 0) {
      return {};
    }
    
    const addressKey = tokenAddresses.join(',');
    const cacheKey = `multi_prices_${addressKey}`;
    
    // Try to get from cache first
    const cachedPrices = this.cache.get(cacheKey);
    if (cachedPrices) {
      return cachedPrices;
    }
    
    try {
      const prices = await this.dexScreener.getMultipleTokenPrices(
        tokenAddresses, 
        mainContext, 
        subContext
      );
      
      // Cache the result
      this.cache.set(cacheKey, prices, this.cacheTimes.prices);
      
      return prices;
    } catch (error) {
      logger.error(`Error getting multiple token prices:`, error);
      return {};
    }
  }

  /**
   * Gets cross-token holder analysis
   * @param {Array<string>} tokenAddresses - List of token addresses to analyze
   * @param {number} minCombinedValue - Minimum combined token value in USD
   * @param {string} mainContext - Context for tracking API calls 
   * @param {string} subContext - Sub-context for tracking API calls
   * @returns {Promise<Array>} List of wallets holding multiple tokens
   */
  async getCrossTokenHolders(tokenAddresses, minCombinedValue = 10000, mainContext = 'default', subContext = null) {
    if (!Array.isArray(tokenAddresses) || tokenAddresses.length < 2) {
      throw new Error("At least 2 token addresses are required for cross analysis");
    }
    
    const sortedAddresses = [...tokenAddresses].sort();
    const cacheKey = `cross_holders_${sortedAddresses.join('_')}_${minCombinedValue}`;
    
    // Try to get from cache first
    const cachedData = this.cache.get(cacheKey);
    if (cachedData) {
      logger.debug(`Cache hit for cross token holders`);
      return cachedData;
    }
    
    try {
      // Get token info and holders for each token
      const tokenInfoPromises = sortedAddresses.map(addr => 
        this.getTokenInfo(addr, mainContext, subContext)
      );
      
      const tokenHoldersPromises = sortedAddresses.map(addr => 
        this.getTokenHolders(addr, 100, mainContext, subContext)
      );
      
      // Run all the requests in parallel
      const [tokenInfoResults, holdersResults] = await Promise.all([
        Promise.allSettled(tokenInfoPromises),
        Promise.allSettled(tokenHoldersPromises)
      ]);
      
      // Extract token info
      const tokenInfos = tokenInfoResults.map((result, index) => ({
        address: sortedAddresses[index],
        info: result.status === 'fulfilled' ? result.value : null
      }));
      
      // Extract holders
      const allHolders = holdersResults.map((result, index) => ({
        tokenAddress: sortedAddresses[index],
        holders: result.status === 'fulfilled' ? result.value : []
      }));
      
      // Find wallets that hold multiple tokens
      const walletHoldings = {};
      
      allHolders.forEach(tokenHolder => {
        const { tokenAddress, holders } = tokenHolder;
        const tokenInfo = tokenInfos.find(info => info.address === tokenAddress)?.info;
        
        holders.forEach(holder => {
          const { address: walletAddress, amount, uiAmount } = holder;
          
          if (!walletHoldings[walletAddress]) {
            walletHoldings[walletAddress] = {
              wallet: walletAddress,
              holdings: [],
              totalValueUsd: 0
            };
          }
          
          // Add this token to the wallet's holdings
          const holdingValue = tokenInfo?.priceUsd ? (uiAmount * tokenInfo.priceUsd) : 0;
          
          walletHoldings[walletAddress].holdings.push({
            tokenAddress,
            amount,
            uiAmount,
            valueUsd: holdingValue,
            symbol: tokenInfo?.symbol || 'Unknown'
          });
          
          walletHoldings[walletAddress].totalValueUsd += holdingValue;
        });
      });
      
      // Filter by minimum combined value and minimum token count
      const crossHolders = Object.values(walletHoldings)
        .filter(wallet => 
          wallet.holdings.length >= 2 && 
          wallet.totalValueUsd >= minCombinedValue
        )
        .sort((a, b) => b.totalValueUsd - a.totalValueUsd);
      
      // Cache the result
      this.cache.set(cacheKey, crossHolders, this.cacheTimes.tokenHolders);
      
      return crossHolders;
    } catch (error) {
      logger.error(`Error analyzing cross token holders:`, error);
      throw error;
    }
  }

  /**
   * Get early buyers for a token
   * @param {string} tokenAddress - The token contract address 
   * @param {string} timeFrame - Time frame to analyze (e.g., "1h", "30m")
   * @param {number} minHoldingPercent - Minimum percent of supply to hold
   * @param {string} mainContext - Context for tracking API calls
   * @param {string} subContext - Sub-context for tracking API calls
   * @returns {Promise<Array>} Early buyer wallets with details
   */
  async getEarlyBuyers(tokenAddress, timeFrame = "1h", minHoldingPercent = 1, mainContext = 'default', subContext = null) {
    // Convert timeFrame to milliseconds
    const timeFrameMs = this._parseTimeFrame(timeFrame);
    const cacheKey = `early_buyers_${tokenAddress}_${timeFrame}_${minHoldingPercent}`;
    
    // Try to get from cache first
    const cachedData = this.cache.get(cacheKey);
    if (cachedData) {
      logger.debug(`Cache hit for early buyers: ${tokenAddress}`);
      return cachedData;
    }
    
    try {
      // Get token info
      const tokenInfo = await this.getTokenInfo(tokenAddress, mainContext, subContext);
      
      // Get transaction history
      const transactions = await this.gmgn.getAllTransactions(tokenAddress, mainContext, subContext, null, 1000);
      
      if (!transactions?.data || !Array.isArray(transactions.data)) {
        throw new Error("Failed to retrieve transaction data");
      }
      
      // Calculate cutoff time
      const now = Date.now();
      const cutoffTime = now - timeFrameMs;
      
      // Filter transactions within timeframe
      const recentTxs = transactions.data.filter(tx => {
        const txTime = tx.timestamp * 1000;
        return txTime >= cutoffTime && tx.side === 'buy';
      });
      
      // Group by wallet
      const walletBuys = {};
      
      recentTxs.forEach(tx => {
        const { maker, amount_token } = tx;
        
        if (!walletBuys[maker]) {
          walletBuys[maker] = {
            wallet: maker,
            totalAmount: 0,
            transactions: []
          };
        }
        
        walletBuys[maker].totalAmount += parseFloat(amount_token || 0);
        walletBuys[maker].transactions.push(tx);
      });
      
      // Calculate minimum amount based on supply and percentage
      const totalSupply = tokenInfo?.totalSupply || 0;
      const minAmount = (totalSupply * minHoldingPercent) / 100;
      
      // Filter by minimum holding
      const earlyBuyers = Object.values(walletBuys)
        .filter(buyer => buyer.totalAmount >= minAmount)
        .sort((a, b) => b.totalAmount - a.totalAmount);
      
      // Enrich with wallet data if available
      const enrichedBuyers = await Promise.all(
        earlyBuyers.map(async buyer => {
          try {
            const walletData = await this.getWalletData(buyer.wallet, '30d', mainContext, subContext);
            return {
              ...buyer,
              walletData: walletData?.data || null,
              solBalance: walletData?.solBalance || 0,
              percentOfSupply: (buyer.totalAmount / totalSupply) * 100
            };
          } catch (error) {
            return {
              ...buyer,
              walletData: null,
              solBalance: 0,
              percentOfSupply: (buyer.totalAmount / totalSupply) * 100
            };
          }
        })
      );
      
      // Cache the result
      this.cache.set(cacheKey, enrichedBuyers, this.cacheTimes.transactions);
      
      return enrichedBuyers;
    } catch (error) {
      logger.error(`Error analyzing early buyers for ${tokenAddress}:`, error);
      throw error;
    }
  }

  /**
   * Invalidates cache for a specific token
   * @param {string} tokenAddress - The token contract address
   */
  invalidateTokenCache(tokenAddress) {
    this.cache.del(`token_info_${tokenAddress}`);
    this.cache.del(`token_holders_${tokenAddress}_100`);
    logger.debug(`Cache invalidated for token: ${tokenAddress}`);
  }

  /**
   * Parse time frame string to milliseconds
   * @private
   */
  _parseTimeFrame(timeFrame) {
    const match = timeFrame.match(/^(\d+)([hmd])$/);
    if (!match) {
      throw new Error(`Invalid time frame format: ${timeFrame}. Expected format: Xh, Xm or Xd`);
    }
    
    const [, value, unit] = match;
    const numValue = parseInt(value, 10);
    
    switch (unit) {
      case 'm': return numValue * 60 * 1000;
      case 'h': return numValue * 60 * 60 * 1000;
      case 'd': return numValue * 24 * 60 * 60 * 1000;
      default: return 60 * 60 * 1000; // default to 1 hour
    }
  }

  /**
   * Private helper to combine token info from different sources
   * @private
   */
  _combineTokenInfo(tokenAddress, gmgnData, dexScreenerData, supplyData) {
    const combinedData = {
      address: tokenAddress,
      name: null,
      symbol: null,
      decimals: null,
      priceUsd: null,
      marketCap: null,
      fdv: null,
      volume24h: null,
      totalSupply: null,
      circulatingSupply: null,
      holders: null,
      createdAt: null,
      securityInfo: null,
      additionalInfo: {}
    };
    
    // Set data from GMGN
    if (gmgnData) {
      combinedData.name = gmgnData.token?.name || combinedData.name;
      combinedData.symbol = gmgnData.token?.symbol || combinedData.symbol;
      combinedData.priceUsd = gmgnData.token?.price_usd || combinedData.priceUsd;
      combinedData.marketCap = gmgnData.token?.market_cap || combinedData.marketCap;
      combinedData.createdAt = gmgnData.token?.created_at || combinedData.createdAt;
      combinedData.additionalInfo.gmgn = gmgnData;
    }
    
    // Set data from DexScreener
    if (dexScreenerData && dexScreenerData.pairData) {
      const dsData = dexScreenerData.pairData;
      combinedData.name = combinedData.name || dsData.name;
      combinedData.symbol = combinedData.symbol || dsData.symbol;
      combinedData.priceUsd = combinedData.priceUsd || dsData.priceUsd;
      combinedData.volume24h = dsData.volume24h;
      combinedData.fdv = dsData.fdv;
      combinedData.additionalInfo.dexScreener = dexScreenerData;
    }
    
    // Set supply data
    if (supplyData && supplyData.value) {
      combinedData.decimals = supplyData.value.decimals;
      combinedData.totalSupply = supplyData.value.uiAmount;
    }
    
    return combinedData;
  }

  /**
   * Private helper to combine holder data from different sources
   * @private
   */
  _combineHolderData(onChainHolders, topBuyers, topTraders) {
    if (!onChainHolders || !Array.isArray(onChainHolders)) {
      return [];
    }
    
    // Create map of wallet addresses to buyer/trader data
    const buyersMap = new Map();
    const tradersMap = new Map();
    
    if (Array.isArray(topBuyers)) {
      topBuyers.forEach(buyer => {
        if (buyer && buyer.address) {
          buyersMap.set(buyer.address, buyer);
        }
      });
    }
    
    if (Array.isArray(topTraders)) {
      topTraders.forEach(trader => {
        if (trader && trader.address) {
          tradersMap.set(trader.address, trader);
        }
      });
    }
    
    // Enhance holders with additional data
    return onChainHolders.map(holder => {
      const buyerData = buyersMap.get(holder.address);
      const traderData = tradersMap.get(holder.address);
      
      return {
        ...holder,
        buyerData: buyerData || null,
        traderData: traderData || null,
        isTrader: !!traderData,
        hasTradeActivity: !!(buyerData || traderData)
      };
    });
  }
}

// Export a singleton instance
module.exports = new UnifiedApiClient();