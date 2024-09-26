const axios = require('axios');
const BigNumber = require('bignumber.js');

HELIUS_API_KEY="17c9f1f1-12e3-41e9-9d15-6143ad66e393"
const HELIUS_URL  = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const DEXSCREENER_URL = 'https://api.dexscreener.com/latest/dex/tokens';

const getAssetsByOwner = async (walletAddress) => {
  const startTime = Date.now();
  try {
    const response = await axios.post(HELIUS_URL, {
      jsonrpc: '2.0',
      id: 'my-id',
      method: 'getAssetsByOwner',
      params: {
        ownerAddress: walletAddress,
        page: 1,
        limit: 1000,
        displayOptions: {
          showFungible: true
        }
      },
    });

    const { result } = response.data;

    let totalValue = new BigNumber(0);
    let tokenInfos = [];
    let tokensWithoutPrice = [];

    if (result.items && Array.isArray(result.items)) {
      result.items.forEach(asset => {
        if (asset.interface === 'FungibleToken') {
          let tokenInfo = {
            symbol: asset.content?.metadata?.symbol || 'Unknown',
            name: asset.content?.metadata?.name || 'Unknown',
            balance: 'N/A',
            value: 'N/A',
            valueNumber: 0,
            mint: asset.id || 'N/A'
          };

          if (asset.token_info) {
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

            if (price === 0 && balance.isGreaterThan(0)) {
              tokensWithoutPrice.push(tokenInfo);
            }
          }

          tokenInfos.push(tokenInfo);
        }
      });

      // Fetch prices from DexScreener for tokens without price
      if (tokensWithoutPrice.length > 0) {
        console.log(`\nFetching prices for ${tokensWithoutPrice.length} tokens from DexScreener...`);
        const dexScreenerPrices = await fetchDexScreenerPrices(tokensWithoutPrice.map(t => t.mint));
        
        tokensWithoutPrice.forEach(token => {
          const dexScreenerInfo = dexScreenerPrices[token.mint];
          if (dexScreenerInfo && dexScreenerInfo.priceUsd) {
            const newValue = new BigNumber(token.balance).multipliedBy(dexScreenerInfo.priceUsd);
            token.value = newValue.toFixed(2);
            token.valueNumber = newValue.toNumber();
            totalValue = totalValue.plus(newValue);
            console.log(`Updated price for ${token.symbol}: $${dexScreenerInfo.priceUsd}`);
          }
        });
      }

      // Sort tokenInfos by value
      tokenInfos.sort((a, b) => b.valueNumber - a.valueNumber);

      // Display sorted results
      console.log("\nSorted Fungible Assets:");
      tokenInfos.forEach(info => {
        console.log(`${info.symbol} (${info.name}): ${info.balance} ($${info.value}) - Mint: ${info.mint}`);
      });
    } else {
      console.log("Unexpected result structure:", result);
    }

    console.log(`\nTotal wallet value: $${totalValue.toFixed(2)}`);
    console.log(`Total number of fungible tokens: ${tokenInfos.length}`);
    
    const endTime = Date.now();
    console.log(`\nTotal execution time: ${(endTime - startTime) / 1000} seconds`);

    return {
      tokenInfos: tokenInfos.slice(0, 3), // Les trois tokens les plus précieux
      totalValue: totalValue.toFixed(2)  // Valeur totale du wallet
    };
  } catch (error) {
    
    console.error('Error fetching assets:', error);
    return {
      tokenInfos: [],
      totalValue: '0.00'
  };
  }
};

const fetchDexScreenerPrices = async (tokenAddresses) => {
  try {
    const response = await axios.get(`${DEXSCREENER_URL}/${tokenAddresses.join(',')}`);
    const prices = {};
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
    return prices;
  } catch (error) {
    console.error('Error fetching prices from DexScreener:', error);
    return {};
  }
};

module.exports = { getAssetsByOwner };