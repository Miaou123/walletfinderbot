const { rateLimitedDexScreenerAxios } = require('../utils/dsrateLimiter');
const { getSolanaApi } = require('../integrations/solanaApi');
const BigNumber = require('bignumber.js');

const getDexScreenerApi = () => {
  return {
    getTokenInfo: async (tokenAddress) => {
      try {
        const solanaApi = getSolanaApi();
        const [tokenResponse, solResponse, tokenSupplyResponse] = await Promise.all([
          rateLimitedDexScreenerAxios({
            method: 'get',
            url: `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`
          }),
          rateLimitedDexScreenerAxios({
            method: 'get',
            url: 'https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112'  
          }),
          solanaApi.getTokenSupply(tokenAddress)
        ]);

        let totalSupply = null;
        let decimals = null;

        if (tokenSupplyResponse && tokenSupplyResponse.value) {
          decimals = tokenSupplyResponse.value.decimals;
          totalSupply = new BigNumber(tokenSupplyResponse.value.amount)
            .dividedBy(new BigNumber(10).pow(decimals));
        } else {
          console.error('Invalid token supply response:', tokenSupplyResponse);
        }
        
        if (tokenResponse.data.pairs && tokenResponse.data.pairs.length > 0) {
          const pair = tokenResponse.data.pairs[0];
          
          let solPrice = 0;
          if (solResponse.data.pairs && solResponse.data.pairs.length > 0) {
            solPrice = parseFloat(solResponse.data.pairs[0].priceUsd);
          }
          
          return {
            name: pair.baseToken.name,
            symbol: pair.baseToken.symbol,
            totalSupply: totalSupply ? totalSupply.toFixed() : null,
            decimals: decimals,
            priceUsd: parseFloat(pair.priceUsd),
            volume24h: parseFloat(pair.volume.h24),
            liquidityUsd: parseFloat(pair.liquidity.usd),
            fdv: parseFloat(pair.fdv),
            dexId: pair.dexId,
            pairCreatedAt: pair.pairCreatedAt,
            priceChange: pair.priceChange,
            txns: pair.txns,
            chainId: pair.chainId,
            solPrice: solPrice
          };
        } else {
          throw new Error('No pair data found for the given token address');
        }
      } catch (error) {
        console.error('Error fetching token info:', error);
        throw error;
      }
    }
  };
};

module.exports = { getDexScreenerApi };