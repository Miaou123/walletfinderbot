const BigNumber = require('bignumber.js');
const { EXCLUDED_ADDRESSES, isExcludedAddress, addExcludedAddress } = require('../utils/excludedAddresses');
const { getSolanaApi } = require('../integrations/solanaApi');
const { getDexScreenerApi } = require('../integrations/dexscreenerApi');
const NodeCache = require('node-cache');

const TIMEOUT = 2 * 60 * 1000;

const solPriceCache = new NodeCache({ stdTTL: 900 });
const solanaApi = getSolanaApi();
const dexScreenerApi = getDexScreenerApi();

const getSolPrice = async () => {
  try {
    let solPrice = solPriceCache.get('solPrice');
    if (solPrice) {
      return new BigNumber(solPrice);
    }

    const SOL_ADDRESS = 'So11111111111111111111111111111111111111112';
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
    console.error('Error fetching SOL price:', error);
    return new BigNumber(0);
  }
};


async function isLiquidityPool(address, mainContext, subContext) {
  try {
    const accountInfo = await solanaApi.getAccountInfo(address, { encoding: 'jsonParsed' }, mainContext, subContext);
    
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

const getAssetsForMultipleWallets = async (walletAddresses, mainContext = 'default', subContext = 'getAssets') => {
  const results = {};
  const solPrice = await getSolPrice();
  const filteredAddresses = walletAddresses.filter(address => !isExcludedAddress(address));
  console.log(`Processing ${filteredAddresses.length} wallets`);
  const uniqueTokensWithoutPrice = new Set();

  const processWalletBatch = async (addresses) => {
    await Promise.all(addresses.map(address => 
      Promise.race([
        processWallet(address),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Timeout processing wallet ${address}`)), TIMEOUT)
        )
      ])
    ));
  };

  const processWallet = async (address) => {
    try {
      console.log(`Processing wallet: ${address}`);
      let allItems = [];
      let page = 1;
      let hasMore = true;

      const poolCheck = await isLiquidityPool(address);
      if (poolCheck.isPool) {
        //console.log(`${address} is a liquidity pool`);
        await addExcludedAddress(address, 'liquidityPool');
        results[address] = { isPool: true, poolName: poolCheck.poolName };
        return;
      }

      while (hasMore && allItems.length <= MAX_UNIQUE_TOKENS) {
        const assetsResponse = await solanaApi.getAssetsByOwner(address, page, ITEMS_PER_PAGE, true, mainContext, subContext);
        
        if (assetsResponse && assetsResponse.items && Array.isArray(assetsResponse.items)) {
          allItems = allItems.concat(assetsResponse.items);
          hasMore = assetsResponse.items.length === ITEMS_PER_PAGE;
          page++;
         // console.log(`Retrieved ${assetsResponse.items.length} items, total: ${allItems.length}`);
        } else {
          hasMore = false;
         // console.log(`No more items for ${address}`);
        }
      }

      if (allItems.length > MAX_UNIQUE_TOKENS) {
      // console.log(`${address} exceeded MAX_UNIQUE_TOKENS, marking as bot`);
        await addExcludedAddress(address, 'bot');
        results[address] = { isBot: true };
        return;
      }

      let totalValue = new BigNumber(0);
      let tokenInfos = [];
      let solBalance = new BigNumber(0);
      let solValue = new BigNumber(0);

      const solBalanceResponse = await solanaApi.getBalance(address, mainContext, subContext);
      
      if (solBalanceResponse && solBalanceResponse.value !== undefined) {
        const solBalanceLamports = new BigNumber(solBalanceResponse.value);
        solBalance = solBalanceLamports.dividedBy(1e9);
        solValue = solBalance.multipliedBy(solPrice);
        totalValue = totalValue.plus(solValue);
      } else {
        console.error(`Invalid SOL balance response for ${address}:`, solBalanceResponse);
      }

      tokenInfos.push({
        symbol: 'SOL',
        name: 'Solana',
        balance: solBalance.toFixed(2),
        value: solValue.toFixed(2),
        valueNumber: solValue.toNumber(),
        mint: 'SOL'
      });

      //console.log(`Processing ${allItems.length} items for ${address}`);
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

     // console.log(`Processed ${tokenInfos.length} tokens for ${address}`);
      results[address] = {
        tokenInfos: tokenInfos,
        totalValue: totalValue.toString(),
        solBalance: solBalance.toFixed(2),
        solValue: solValue.toFixed(2),
        totalAssets: tokenInfos.length
      };
    } catch (error) {
      console.error(`Error processing wallet ${address}:`, error);
      results[address] = {
        tokenInfos: [],
        totalValue: '0',
        solBalance: '0.00',
        solValue: '0.00',
        totalAssets: 0,
        error: error.message
      };
    }
  };

  const BATCH_SIZE = 10;
  for (let i = 0; i < filteredAddresses.length; i += BATCH_SIZE) {
    const batch = filteredAddresses.slice(i, i + BATCH_SIZE);
    //console.log(`Processing batch ${i / BATCH_SIZE + 1} of ${Math.ceil(filteredAddresses.length / BATCH_SIZE)}`);
    await processWalletBatch(batch);
    if (i + BATCH_SIZE < filteredAddresses.length) {
      await new Promise(resolve => setTimeout(resolve, 1000)); 
    }
  }

  console.log(`Unique tokens without price: ${uniqueTokensWithoutPrice.size}`);
  if (uniqueTokensWithoutPrice.size > 0) {
    console.log('Fetching prices from DexScreener');
    const dexScreenerPrices = await fetchDexScreenerPrices(Array.from(uniqueTokensWithoutPrice));
    //console.log(`Retrieved prices for ${Object.keys(dexScreenerPrices).length} tokens`);
    
    for (const address of filteredAddresses) {
      const wallet = results[address];
      if (wallet && wallet.tokenInfos) {
        wallet.tokenInfos.forEach(token => {
          const dexScreenerInfo = dexScreenerPrices[token.mint];
          if (dexScreenerInfo && dexScreenerInfo.priceUsd) {
            const newValue = new BigNumber(token.balance).multipliedBy(dexScreenerInfo.priceUsd);
            token.value = newValue.toFixed(2);
            token.valueNumber = newValue.toNumber();
            wallet.totalValue = new BigNumber(wallet.totalValue).plus(newValue).toString();

          }
        });
        
        wallet.tokenInfos.sort((a, b) => b.valueNumber - a.valueNumber);
        wallet.totalValue = wallet.tokenInfos.reduce((sum, token) => sum.plus(new BigNumber(token.value)), new BigNumber(0)).toString();
      }
    }
  }

  console.log('getAssetsForMultipleWallets completed');
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
  //console.log(`Starting fetchDexScreenerPrices with ${tokenAddresses.length} tokens`);
  const tokenChunks = chunkArray(tokenAddresses, chunkSize);
 // console.log(`Split into ${tokenChunks.length} chunks of size ${chunkSize}`);
  
  const prices = {};
  const dexScreenerApi = getDexScreenerApi();

  for (let i = 0; i < tokenChunks.length; i++) {
    const chunk = tokenChunks[i];
   // console.log(`Processing chunk ${i + 1}/${tokenChunks.length}: ${chunk.join(',')}`);
    
    try {
      //console.log(`Calling getMultipleTokenPrices for chunk ${i + 1}`);
      const chunkPrices = await dexScreenerApi.getMultipleTokenPrices(chunk);
      //console.log(`Received prices for chunk ${i + 1}:`, chunkPrices);
      
      Object.assign(prices, chunkPrices);
     // console.log(`Updated prices object. Current keys: ${Object.keys(prices).join(', ')}`);
    } catch (error) {
      // console.error(`Error fetching prices for chunk ${i + 1}: ${chunk.join(',')}`, error);
      // console.error('Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    }
  }

  //console.log(`Finished fetchDexScreenerPrices. Total prices fetched: ${Object.keys(prices).length}`);
  return prices;
};

module.exports = { getAssetsForMultipleWallets };