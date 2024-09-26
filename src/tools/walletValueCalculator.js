const BigNumber = require('bignumber.js');
const { rateLimitedAxios } = require('../utils/rateLimiter');
const { rateLimitedDexScreenerAxios } = require('../utils/dsrateLimiter');
const { EXCLUDED_ADDRESSES, isExcludedAddress, addExcludedAddress } = require('../utils/excludedAddresses');
const config = require('../utils/config');
const { getSolanaApi } = require('../integrations/solanaApi');
const NodeCache = require('node-cache');

const DEXSCREENER_URL = 'https://api.dexscreener.com/latest/dex/tokens';

const solPriceCache = new NodeCache({ stdTTL: 900 });

const getSolPrice = async () => {
  try {
    let solPrice = solPriceCache.get('solPrice');
    if (solPrice) {
      return new BigNumber(solPrice);
    }

    const solPriceResponse = await rateLimitedDexScreenerAxios({
      method: 'get',
      url: `${DEXSCREENER_URL}/So11111111111111111111111111111111111111112`
    });

    if (!solPriceResponse.data || !solPriceResponse.data.pairs || solPriceResponse.data.pairs.length === 0) {
      throw new Error('Unexpected SOL price response structure');
    }

    const bestPair = solPriceResponse.data.pairs.reduce((best, current) => {
      return (current.liquidity?.usd || 0) > (best.liquidity?.usd || 0) ? current : best;
    }, solPriceResponse.data.pairs[0]);

    solPrice = bestPair.priceUsd;
    
    if (!solPrice) {
      throw new Error('Unable to find valid SOL price');
    }

    solPriceCache.set('solPrice', solPrice);
    return new BigNumber(solPrice);
  } catch (error) {
    console.error('Error fetching SOL price:', error);
    console.error('Error details:', error.response?.data);
    return new BigNumber(0);
  }
};

async function getAccountInfo(address) {
    try {
      const response = await rateLimitedAxios({
        method: 'post',
        url: config.HELIUS_RPC_URL,
        data: {
          jsonrpc: '2.0',
          id: 'my-id',
          method: 'getAccountInfo',
          params: [
            address,
            {
              encoding: 'jsonParsed'
            }
          ]
        }
      }, true);
  
      const accountInfo = response.data.result.value;
  
      if (!accountInfo) {
        return null;
      }
  
      return {
        lamports: accountInfo.lamports,
        owner: accountInfo.owner,
        executable: accountInfo.executable,
        rentEpoch: accountInfo.rentEpoch,
        data: accountInfo.data,
        size: accountInfo.data.length
      };
    } catch (error) {
      console.error(`Error getting account info for ${address}:`, error);
      throw error;
    }
  }
  
  async function isLiquidityPool(address) {
    try {
      const accountInfo = await getAccountInfo(address);
      
      if (!accountInfo) {
        return { isPool: false };
      }
  
      const knownPoolPrograms = [
        'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
        '5quBtoiQqxF9Jv6KYKctB59NT3gtJD2Y65kdnB1Uev3h',
      ];
  
      if (knownPoolPrograms.includes(accountInfo.owner)) {
        return { isPool: true, poolName: 'Liquidity Pool' };
      }
  
      return { isPool: false };
    } catch (error) {
      console.error(`Error checking if ${address} is a liquidity pool:`, error);
      return { isPool: false };
    }
  }
  
const MAX_UNIQUE_TOKENS = 1000;
const ITEMS_PER_PAGE = 1000;

const getAssetsForMultipleWallets = async (walletAddresses) => {
  const solanaApi = getSolanaApi();
  const results = {};
  const solPrice = await getSolPrice();
  const filteredAddresses = walletAddresses.filter(address => !isExcludedAddress(address));
  const uniqueTokensWithoutPrice = new Set();

  await Promise.all(filteredAddresses.map(async (address) => {
    try {
      let allItems = [];
      let page = 1;
      let hasMore = true;

      const poolCheck = await isLiquidityPool(address);

      if (poolCheck.isPool) {
        await addExcludedAddress(address, 'liquidityPool');
        results[address] = { isPool: true, poolName: poolCheck.poolName };
        return;
      }

      while (hasMore && allItems.length <= MAX_UNIQUE_TOKENS) {
        const assetsResponse = await solanaApi.getAssetsByOwner(address, page, ITEMS_PER_PAGE);
        
        if (assetsResponse && assetsResponse.items && Array.isArray(assetsResponse.items)) {
          allItems = allItems.concat(assetsResponse.items);
          hasMore = assetsResponse.items.length === ITEMS_PER_PAGE;
          page++;
        } else {
          hasMore = false;
        }
      }

      const solBalanceResponse = await solanaApi.getBalance(address);

      if (allItems.length > MAX_UNIQUE_TOKENS) {
        await addExcludedAddress(address, 'bot');
        results[address] = { isBot: true };
        return;
      }

      let totalValue = new BigNumber(0);
      let tokenInfos = [];

      const solBalanceLamports = new BigNumber(solBalanceResponse);
      const solBalance = solBalanceLamports.dividedBy(1e9);
      const solValue = solBalance.multipliedBy(solPrice);
      totalValue = totalValue.plus(solValue);

      tokenInfos.push({
        symbol: 'SOL',
        name: 'Solana',
        balance: solBalance.toFixed(2),
        value: solValue.toFixed(2),
        valueNumber: solValue.toNumber(),
        mint: 'SOL'
      });


      allItems.forEach(asset => {
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

          if (!value.isNaN()) {
              totalValue = totalValue.plus(value);
          }

          if (price === 0 && balance.isGreaterThan(0) && 
              balance.isGreaterThan(100000) && 
              !tokenInfo.mint.startsWith('JD')) {
            uniqueTokensWithoutPrice.add(tokenInfo.mint);
          }

          tokenInfos.push(tokenInfo);
        }
      });

      results[address] = {
        tokenInfos: tokenInfos,
        totalValue: totalValue,
        solBalance: solBalance.toFixed(2),
        solValue: solValue.toFixed(2),
        totalAssets: tokenInfos.length
      };

    } catch (error) {
      console.error(`Error fetching assets for ${address}:`, error);
      results[address] = {
        tokenInfos: [],
        totalValue: new BigNumber(0),
        solBalance: '0.00',
        solValue: '0.00',
        totalAssets: 0,
        error: error.message
      };
    }
  }));

  if (uniqueTokensWithoutPrice.size > 0) {
    const dexScreenerPrices = await fetchDexScreenerPrices(Array.from(uniqueTokensWithoutPrice));
    
    for (const address of filteredAddresses) {
      const wallet = results[address];
      if (wallet && wallet.tokenInfos) {
        wallet.tokenInfos.forEach(token => {
          const dexScreenerInfo = dexScreenerPrices[token.mint];
          if (dexScreenerInfo && dexScreenerInfo.priceUsd) {
            const newValue = new BigNumber(token.balance).multipliedBy(dexScreenerInfo.priceUsd);
            token.value = newValue.toFixed(2);
            token.valueNumber = newValue.toNumber();
            wallet.totalValue = wallet.totalValue.plus(newValue);
          }
        });
        
        wallet.tokenInfos.sort((a, b) => b.valueNumber - a.valueNumber);
        wallet.totalValue = wallet.tokenInfos.reduce((sum, token) => sum.plus(new BigNumber(token.value)), new BigNumber(0));
      }
    }
  }

  return results;
};

const chunkArray = (arr, size) => {
  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
};

const fetchDexScreenerPrices = async (tokenAddresses, chunkSize = 10) => {
  const tokenChunks = chunkArray(tokenAddresses, chunkSize);
  const prices = {};

  for (const chunk of tokenChunks) {
    try {
      const response = await rateLimitedDexScreenerAxios({
        method: 'get',
        url: `${DEXSCREENER_URL}/${chunk.join(',')}`
      });
      
      if (response.data && response.data.pairs) {
        response.data.pairs.forEach(pair => {
          if (pair.chainId === 'solana') {
            prices[pair.baseToken.address] = {
              priceUsd: pair.priceUsd,
              symbol: pair.baseToken.symbol
            };
          }
        });
      }
    } catch (error) {
      console.error(`Error fetching prices for chunk: ${chunk.join(',')}`, error);
    }
  }

  return prices;
};

module.exports = { getAssetsForMultipleWallets };