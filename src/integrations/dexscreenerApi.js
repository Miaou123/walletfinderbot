const { rateLimitedDexScreenerAxios } = require('../utils/dsrateLimiter');
const { Connection, PublicKey } = require('@solana/web3.js');
const { rateLimitedAxios } = require('../utils/rateLimiter');
const config = require('../utils/config');
const BigNumber = require('bignumber.js');

const getDexScreenerApi = () => {
  return {
    getTokenInfo: async (tokenAddress) => {
      try {
        const [tokenResponse, solResponse, totalSupply] = await Promise.all([
          rateLimitedDexScreenerAxios({
            method: 'get',
            url: `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`
          }),
          rateLimitedDexScreenerAxios({
            method: 'get',
            url: 'https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112'  
          }),
          getTotalSupply(tokenAddress)
        ]);
        
        if (tokenResponse.data.pairs && tokenResponse.data.pairs.length > 0) {
          const pair = tokenResponse.data.pairs[0]; // We'll use the first pair's data
          
          let solPrice = 0;
          if (solResponse.data.pairs && solResponse.data.pairs.length > 0) {
            solPrice = parseFloat(solResponse.data.pairs[0].priceUsd);
          }
          
          return {
            name: pair.baseToken.name,
            symbol: pair.baseToken.symbol,
            totalSupply: totalSupply.totalSupply.toNumber(),
            decimals: totalSupply.decimals,
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

async function getTotalSupply(tokenAddress) {
  try {
    const connection = new Connection(config.HELIUS_RPC_URL);
    const tokenPublicKey = new PublicKey(tokenAddress);
    const tokenAccountInfo = await connection.getAccountInfo(tokenPublicKey);

    if (!tokenAccountInfo) {
      throw new Error('Token account not found');
    }

    const response = await rateLimitedAxios({
      method: 'post',
      url: config.HELIUS_RPC_URL,
      data: {
        jsonrpc: '2.0',
        id: 'token-info',
        method: 'getTokenSupply',
        params: [tokenAddress]
      }
    }, true);

    if (response.data.error) {
      throw new Error(`API error: ${response.data.error.message}`);
    }

    const tokenSupply = response.data.result.value;
    const totalSupply = new BigNumber(tokenSupply.amount).dividedBy(Math.pow(10, tokenSupply.decimals));

    return { totalSupply, decimals: tokenSupply.decimals };
  } catch (error) {
    console.error('Error getting total supply:', error);
    throw error;
  }
}

module.exports = { getDexScreenerApi };