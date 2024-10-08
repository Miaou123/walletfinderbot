const BigNumber = require('bignumber.js');
const { isExcludedAddress, addExcludedAddress } = require('../utils/excludedAddresses');
const { getSolanaApi } = require('../integrations/solanaApi');
const dexScreenerApi = require('../integrations/dexScreenerApi');
const NodeCache = require('node-cache');
const logger = require('../utils/logger');

// Constants
const TIMEOUT = 2 * 60 * 1000;
const MAX_UNIQUE_TOKENS = 1000;
const ITEMS_PER_PAGE = 1000;
const BATCH_SIZE = 10;
const SOL_ADDRESS = 'So11111111111111111111111111111111111111112';
const KNOWN_POOL_PROGRAMS = [
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
  '5quBtoiQqxF9Jv6KYKctB59NT3gtJD2Y65kdnB1Uev3h',
];

// Cache setup
const solPriceCache = new NodeCache({ stdTTL: 900 });
const solanaApi = getSolanaApi();

/**
 * Fetches the current SOL price.
 * @returns {Promise<BigNumber>} The SOL price.
 */
const getSolPrice = async () => {
  try {
    let solPrice = solPriceCache.get('solPrice');
    if (solPrice) {
      return new BigNumber(solPrice);
    }

    const solPriceData = await dexScreenerApi.getMultipleTokenPrices([SOL_ADDRESS]);

    if (!solPriceData || !solPriceData[SOL_ADDRESS]) {
      throw new Error('Unexpected SOL price response structure');
    }

    solPrice = solPriceData[SOL_ADDRESS].priceUsd;
    
    if (!solPrice) {
      throw new Error('Unable to find valid SOL price');
    }

    solPriceCache.set('solPrice', solPrice);
    return new BigNumber(solPrice);
  } catch (error) {
    logger.error('Error fetching SOL price:', error);
    return new BigNumber(0);
  }
};

/**
 * Checks if a given address is a liquidity pool.
 * @param {string} address - The address to check.
 * @param {string} mainContext - The main context for the Solana API call.
 * @param {string} subContext - The sub-context for the Solana API call.
 * @returns {Promise<{isPool: boolean, poolName?: string}>} Result of the check.
 */
async function isLiquidityPool(address, mainContext, subContext) {
  try {
    const accountInfo = await solanaApi.getAccountInfo(address, { encoding: 'jsonParsed' }, mainContext, subContext);
    
    if (!accountInfo || !accountInfo.owner) {
      return { isPool: false };
    }

    if (KNOWN_POOL_PROGRAMS.includes(accountInfo.owner)) {
      return { isPool: true, poolName: 'Liquidity Pool' };
    }

    return { isPool: false };
  } catch (error) {
    logger.error(`Error checking if ${address} is a liquidity pool:`, error);
    return { isPool: false };
  }
}

/**
 * Fetches all items for a given wallet address.
 * @param {string} address - The wallet address.
 * @param {string} mainContext - The main context for API calls.
 * @param {string} subContext - The sub-context for API calls.
 * @returns {Promise<Array>} All items fetched for the wallet.
 */
async function fetchAllItems(address, mainContext, subContext) {
  let allItems = [];
  let page = 1;
  let hasMore = true;

  while (hasMore && allItems.length <= MAX_UNIQUE_TOKENS) {
    try {
      const assetsResponse = await solanaApi.getAssetsByOwner(address, page, ITEMS_PER_PAGE, true, mainContext, subContext);
      
      if (assetsResponse && assetsResponse.items && Array.isArray(assetsResponse.items)) {
        allItems = allItems.concat(assetsResponse.items);
        hasMore = assetsResponse.items.length === ITEMS_PER_PAGE;
        page++;
      } else {
        logger.error(`Invalid response for getAssetsByOwner: ${address}`);
        hasMore = false;
      }
    } catch (error) {
      logger.error(`Error fetching assets for ${address} on page ${page}:`, error);
      hasMore = false;
    }
  }

  return allItems;
}

/**
 * Fetches SOL balance for a given wallet address.
 * @param {string} address - The wallet address.
 * @param {BigNumber} solPrice - The current SOL price.
 * @param {string} mainContext - The main context for API calls.
 * @param {string} subContext - The sub-context for API calls.
 * @returns {Promise<{solBalance: BigNumber, solValue: BigNumber}>} SOL balance and value.
 */
async function fetchSolBalance(address, solPrice, mainContext, subContext) {
  try {
    const solBalanceResponse = await solanaApi.getBalance(address, mainContext, subContext);
    
    if (solBalanceResponse && solBalanceResponse.value !== undefined) {
      const solBalanceLamports = new BigNumber(solBalanceResponse.value);
      const solBalance = solBalanceLamports.dividedBy(1e9);
      const solValue = solBalance.multipliedBy(solPrice);
      return { solBalance, solValue };
    } else {
      logger.error(`Invalid SOL balance response for ${address}:`, solBalanceResponse);
      return { solBalance: new BigNumber(0), solValue: new BigNumber(0) };
    }
  } catch (error) {
    logger.error(`Error fetching SOL balance for ${address}:`, error);
    return { solBalance: new BigNumber(0), solValue: new BigNumber(0) };
  }
}

/**
 * Processes items fetched for a wallet.
 * @param {Array} items - The items to process.
 * @param {BigNumber} solBalance - The SOL balance.
 * @param {BigNumber} solValue - The SOL value.
 * @returns {Array} Processed token information.
 */
function processItems(items, solBalance, solValue) {
  let tokenInfos = [{
    symbol: 'SOL',
    name: 'Solana',
    balance: solBalance.toFixed(2),
    value: solValue.toFixed(2),
    valueNumber: solValue.toNumber(),
    mint: 'SOL'
  }];

  items.forEach(asset => {
    if (asset.interface === 'FungibleToken' && asset.token_info) {
      let tokenInfo = {
        symbol: asset.content?.metadata?.symbol || 'Unknown',
        name: asset.content?.metadata?.name || 'Unknown',
        balance: 'N/A',
        value: 'N/A',
        valueNumber: 0,
        mint: asset.id || 'N/A'
      };

      const balance = new BigNumber(asset.token_info.balance || 0);
      const decimals = asset.token_info.decimals || 0;
      const price = asset.token_info.price_info ? asset.token_info.price_info.price_per_token || 0 : 0;
      const value = balance.dividedBy(10 ** decimals).multipliedBy(price);

      tokenInfo.balance = balance.dividedBy(10 ** decimals).toFixed(2);
      tokenInfo.value = value.toFixed(2);
      tokenInfo.valueNumber = value.toNumber();
      tokenInfo.decimals = decimals;

      tokenInfos.push(tokenInfo);
    }
  });

  return tokenInfos;
}

/**
 * Processes a single wallet address.
 * @param {string} address - The wallet address to process.
 * @param {BigNumber} solPrice - The current SOL price.
 * @param {string} mainContext - The main context for API calls.
 * @param {string} subContext - The sub-context for API calls.
 * @returns {Promise<Object>} The processed wallet data.
 */
async function processWallet(address, solPrice, mainContext, subContext) {
  try {
    logger.info(`Processing wallet: ${address}`);
    
    const poolCheck = await isLiquidityPool(address, mainContext, subContext);
    if (poolCheck.isPool) {
      await addExcludedAddress(address, 'liquidityPool');
      return { isPool: true, poolName: poolCheck.poolName };
    }

    const allItems = await fetchAllItems(address, mainContext, subContext);

    if (allItems.length > MAX_UNIQUE_TOKENS) {
      await addExcludedAddress(address, 'bot');
      return { isBot: true };
    }

    const { solBalance, solValue } = await fetchSolBalance(address, solPrice, mainContext, subContext);
    const tokenInfos = processItems(allItems, solBalance, solValue);

    const totalValue = tokenInfos.reduce((sum, token) => sum.plus(new BigNumber(token.value)), new BigNumber(0));

    return {
      tokenInfos,
      totalValue: totalValue.toString(),
      solBalance: solBalance.toFixed(2),
      solValue: solValue.toFixed(2),
      totalAssets: tokenInfos.length
    };
  } catch (error) {
    console.error(`Error processing wallet ${address}:`, error);
    return {
      tokenInfos: [],
      totalValue: '0',
      solBalance: '0.00',
      solValue: '0.00',
      totalAssets: 0,
      error: error.message
    };
  }
}

/**
 * Processes wallets in batches.
 * @param {string[]} addresses - Array of wallet addresses to process.
 * @param {Function} processFunction - Function to process each wallet.
 */
async function processBatches(addresses, processFunction) {
  for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
    const batch = addresses.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(address => 
      Promise.race([
        processFunction(address),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Timeout processing wallet ${address}`)), TIMEOUT)
        )
      ])
    ));
    if (i + BATCH_SIZE < addresses.length) {
      await new Promise(resolve => setTimeout(resolve, 1000)); 
    }
  }
}

/**
 * Updates the set of unique tokens without price.
 * @param {Object} walletData - Processed data for a wallet.
 * @param {Set} uniqueTokensWithoutPrice - Set to update.
 */
function updateUniqueTokensWithoutPrice(walletData, uniqueTokensWithoutPrice) {
  if (walletData.tokenInfos) {
    walletData.tokenInfos.forEach(token => {
      if (token.value === '0.00' && new BigNumber(token.balance).isGreaterThan(100000) && !token.mint.startsWith('JD')) {
        uniqueTokensWithoutPrice.add(token.mint);
      }
    });
  }
}

/**
 * Fetches prices from DexScreener for tokens without price.
 * @param {string[]} tokenAddresses - Array of token addresses to fetch prices for.
 * @param {number} chunkSize - Size of chunks for API calls.
 * @returns {Promise<Object>} Object with token prices.
 */
async function fetchDexScreenerPrices(tokenAddresses, chunkSize = 10) {
  const tokenChunks = chunkArray(tokenAddresses, chunkSize);
  const prices = {};

  for (const chunk of tokenChunks) {
    try {
      const chunkPrices = await dexScreenerApi.getMultipleTokenPrices(chunk);
      Object.assign(prices, chunkPrices);
    } catch (error) {
      logger.error(`Error fetching prices for chunk: ${chunk.join(',')}`, error);
    }
  }

  return prices;
}

/**
 * Updates wallet data with prices from DexScreener.
 * @param {Object} results - Processed data for all wallets.
 * @param {Set} uniqueTokensWithoutPrice - Set of tokens without price.
 */
async function updatePricesWithDexScreener(results, uniqueTokensWithoutPrice) {
  if (uniqueTokensWithoutPrice.size > 0) {
    logger.info('Fetching prices from DexScreener');
    const dexScreenerPrices = await fetchDexScreenerPrices(Array.from(uniqueTokensWithoutPrice));
    
    for (const wallet of Object.values(results)) {
      if (wallet.tokenInfos) {
        wallet.tokenInfos.forEach(token => {
          const dexScreenerInfo = dexScreenerPrices[token.mint];
          if (dexScreenerInfo && dexScreenerInfo.priceUsd) {
            const newValue = new BigNumber(token.balance).multipliedBy(dexScreenerInfo.priceUsd);
            token.value = newValue.toFixed(2);
            token.valueNumber = newValue.toNumber();
          }
        });
        
        wallet.tokenInfos.sort((a, b) => b.valueNumber - a.valueNumber);
        wallet.totalValue = wallet.tokenInfos.reduce((sum, token) => sum.plus(new BigNumber(token.value)), new BigNumber(0)).toString();
      }
    }
  }
}

/**
 * Splits an array into chunks of a specified size.
 * @param {Array} arr - The array to split.
 * @param {number} size - The size of each chunk.
 * @returns {Array} Array of chunks.
 */
function chunkArray(arr, size) {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );
}

/**
 * Fetches and processes assets for multiple wallet addresses.
 * @param {string[]} walletAddresses - Array of wallet addresses to process.
 * @param {string} mainContext - The main context for API calls.
 * @param {string} subContext - The sub-context for API calls.
 * @returns {Promise<Object>} Processed data for all wallets.
 */
const getAssetsForMultipleWallets = async (walletAddresses, mainContext = 'default', subContext = 'getAssets') => {
  const results = {};
  const solPrice = await getSolPrice();
  const filteredAddresses = walletAddresses.filter(address => !isExcludedAddress(address));
  logger.info(`Processing ${filteredAddresses.length} wallets`);
  const uniqueTokensWithoutPrice = new Set();

  await processBatches(filteredAddresses, async (address) => {
    results[address] = await processWallet(address, solPrice, mainContext, subContext);
    updateUniqueTokensWithoutPrice(results[address], uniqueTokensWithoutPrice);
  });

  await updatePricesWithDexScreener(results, uniqueTokensWithoutPrice);

  logger.info('getAssetsForMultipleWallets completed');
  return results;
};

module.exports = { getAssetsForMultipleWallets };