const dexscreenerRateLimiter = require('../utils/rateLimiters/dexscreenerRateLimiter');
const { getSolanaApi } = require('./solanaApi');
const BigNumber = require('bignumber.js');
const ApiCallCounter = require('../utils/ApiCallCounter');

class DexScreenerApi {
    constructor() {
        this.solanaApi = getSolanaApi();
    }

    //test123

    async getTokenInfo(tokenAddress, mainContext = 'default', subContext = null) {
        ApiCallCounter.incrementCall('DexScreener', 'getTokenInfo', mainContext, subContext);

        try {
            const [tokenResponse, solResponse, tokenSupplyResponse] = await Promise.all([
                this.fetchDexScreenerData(`tokens/${tokenAddress}`),
                this.fetchDexScreenerData('tokens/So11111111111111111111111111111111111111112'),
                this.solanaApi.getTokenSupply(tokenAddress)
            ]);

            const { totalSupply, decimals } = this.extractTokenSupply(tokenSupplyResponse);
            const tokenInfo = this.extractTokenInfo(tokenResponse, solResponse, totalSupply, decimals);

            return tokenInfo;
        } catch (error) {
            console.error('Error fetching token info:', error);
            throw error;
        }
    }

    async getMultipleTokenPrices(tokenAddresses, mainContext = 'default', subContext = null) {
        ApiCallCounter.incrementCall('DexScreener', 'getMultipleTokenPrices', mainContext, subContext);

        console.log(`getMultipleTokenPrices called with ${tokenAddresses.length} addresses`);
        this.validateTokenAddresses(tokenAddresses);

        try {
            console.log(`Calling DexScreener API for addresses: ${tokenAddresses.join(',')}`);
            const response = await this.fetchDexScreenerData(`tokens/${tokenAddresses.join(',')}`);

            if (!response.data || !response.data.pairs) {
                console.error('Unexpected response structure:', response.data);
                throw new Error('Unexpected response structure from DexScreener');
            }

            const prices = this.extractTokenPrices(response.data.pairs);
            console.log(`Processed prices:`, prices);
            return prices;
        } catch (error) {
            console.error('Error in getMultipleTokenPrices:', error);
            console.error('Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
            throw error;
        }
    }

    async fetchDexScreenerData(endpoint) {
        return dexscreenerRateLimiter.enqueue({
            method: 'get',
            url: `https://api.dexscreener.com/latest/dex/${endpoint}`
        });
    }

    extractTokenSupply(tokenSupplyResponse) {
        let totalSupply = null;
        let decimals = null;

        if (tokenSupplyResponse && tokenSupplyResponse.value) {
            decimals = tokenSupplyResponse.value.decimals;
            totalSupply = new BigNumber(tokenSupplyResponse.value.amount)
                .dividedBy(new BigNumber(10).pow(decimals));
        } else {
            console.error('Invalid token supply response:', tokenSupplyResponse);
        }

        return { totalSupply, decimals };
    }

    extractTokenInfo(tokenResponse, solResponse, totalSupply, decimals) {
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
    }

    validateTokenAddresses(tokenAddresses) {
        if (!Array.isArray(tokenAddresses) || tokenAddresses.length === 0 || tokenAddresses.length > 10) {
            throw new Error('Invalid input: tokenAddresses must be an array with 1 to 10 addresses');
        }
    }

    extractTokenPrices(pairs) {
        const prices = {};
        pairs.forEach(pair => {
            if (pair.chainId === 'solana') {
                prices[pair.baseToken.address] = {
                    priceUsd: parseFloat(pair.priceUsd),
                    symbol: pair.baseToken.symbol
                };
            }
        });
        return prices;
    }
}

module.exports = new DexScreenerApi();