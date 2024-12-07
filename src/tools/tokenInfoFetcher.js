// tools/TokenInfoFetcher.js
const logger = require('../utils/logger');
const gmgnApi = require('../integrations/gmgnApi');
const dexscreenerApi = require('../integrations/dexScreenerApi');

class TokenInfoFetcher {
    constructor() {
        this.gmgnApi = gmgnApi;
        this.dexscreenerApi = dexscreenerApi;
    }

    async getTokenInfo(mintAddress) {
        try {
            // Essayer d'abord GMGN
            const gmgnInfo = await this.gmgnApi.getTokenInfo(mintAddress);
            if (gmgnInfo?.data?.token) {
                return this._formatGmgnData(gmgnInfo.data.token);
            }

            // Fallback sur DexScreener
            const dexInfo = await this.dexscreenerApi.getTokenInfo(mintAddress);
            if (dexInfo?.pairs?.length > 0) {
                return this._formatDexScreenerData(dexInfo.pairs);
            }

            return null;
        } catch (error) {
            logger.error(`Error fetching token info for ${mintAddress}:`, error);
            return null;
        }
    }

    _formatGmgnData(token) {
        return {
            address: token.address,
            name: token.name,
            symbol: token.symbol,
            decimals: token.decimals,
            price: {
                current: token.price,
                history: {
                    m5: token.price_5m,
                    h1: token.price_1h,
                    h6: token.price_6h,
                    h24: token.price_24h
                },
                change: {
                    m5: token.price_5m ? ((token.price / token.price_5m - 1) * 100) : null,
                    h1: token.price_1h ? ((token.price / token.price_1h - 1) * 100) : null,
                    h6: token.price_6h ? ((token.price / token.price_6h - 1) * 100) : null,
                    h24: token.price_24h ? ((token.price / token.price_24h - 1) * 100) : null
                }
            },
            volume: {
                h24: token.volume_24h,
                h6: token.volume_6h,
                h1: token.volume_1h,
                m5: token.volume_5m
            },
            transactions: {
                h24: {
                    buys: token.buys_24h,
                    sells: token.sells_24h,
                    total: token.swaps_24h
                },
                h6: {
                    buys: token.buys_6h,
                    sells: token.sells_6h,
                    total: token.swaps_6h
                },
                h1: {
                    buys: token.buys_1h,
                    sells: token.sells_1h,
                    total: token.swaps_1h
                },
                m5: {
                    buys: token.buys_5m,
                    sells: token.sells_5m,
                    total: token.swaps_5m
                }
            },
            liquidity: token.liquidity,
            marketCap: token.market_cap,
            fdv: token.fdv,
            supply: {
                max: token.max_supply,
                total: token.total_supply,
                circulating: token.circulating_supply
            },
            holders: {
                count: token.holder_count,
                top10Percentage: token.top_10_holder_rate
            },
            social: {
                twitter: token.social_links?.twitter_username ? `https://twitter.com/${token.social_links.twitter_username}` : null,
                telegram: token.social_links?.telegram,
                website: token.social_links?.website,
                discord: token.social_links?.discord
            },
            launchInfo: {
                platform: token.launchpad,
                creationTime: token.creation_timestamp,
                openTime: token.open_timestamp
            },
            security: {
                renounced: {
                    mint: Boolean(token.renounced_mint),
                    freezeAccount: Boolean(token.renounced_freeze_account)
                },
                burnRatio: token.burn_ratio,
                burnStatus: token.burn_status
            },
            pool: token.pool_info ? {
                address: token.pool_info.address,
                baseReserve: token.pool_info.base_reserve,
                quoteReserve: token.pool_info.quote_reserve,
                initialLiquidity: token.pool_info.initial_liquidity
            } : null,
            source: 'gmgn'
        };
    }

    _formatDexScreenerData(pairs) {
        // On prend la paire avec le plus de liquidité
        const mainPair = pairs.reduce((prev, curr) => 
            (curr.liquidity?.usd || 0) > (prev.liquidity?.usd || 0) ? curr : prev
        );

        const baseToken = mainPair.baseToken;
        return {
            address: baseToken.address,
            name: baseToken.name,
            symbol: baseToken.symbol,
            price: {
                current: Number(mainPair.priceUsd),
                history: {},
                change: {
                    m5: mainPair.priceChange?.m5 || null,
                    h1: mainPair.priceChange?.h1 || null,
                    h6: mainPair.priceChange?.h6 || null,
                    h24: mainPair.priceChange?.h24 || null
                }
            },
            volume: {
                h24: mainPair.volume?.h24 || 0,
                h6: mainPair.volume?.h6 || 0,
                h1: mainPair.volume?.h1 || 0,
                m5: mainPair.volume?.m5 || 0
            },
            transactions: {
                h24: {
                    buys: mainPair.txns?.h24?.buys || 0,
                    sells: mainPair.txns?.h24?.sells || 0,
                    total: (mainPair.txns?.h24?.buys || 0) + (mainPair.txns?.h24?.sells || 0)
                },
                h6: {
                    buys: mainPair.txns?.h6?.buys || 0,
                    sells: mainPair.txns?.h6?.sells || 0,
                    total: (mainPair.txns?.h6?.buys || 0) + (mainPair.txns?.h6?.sells || 0)
                },
                h1: {
                    buys: mainPair.txns?.h1?.buys || 0,
                    sells: mainPair.txns?.h1?.sells || 0,
                    total: (mainPair.txns?.h1?.buys || 0) + (mainPair.txns?.h1?.sells || 0)
                },
                m5: {
                    buys: mainPair.txns?.m5?.buys || 0,
                    sells: mainPair.txns?.m5?.sells || 0,
                    total: (mainPair.txns?.m5?.buys || 0) + (mainPair.txns?.m5?.sells || 0)
                }
            },
            liquidity: mainPair.liquidity?.usd || 0,
            marketCap: mainPair.marketCap || null,
            fdv: mainPair.fdv || null,
            social: {
                twitter: mainPair.info?.socials?.find(s => s.type === 'twitter')?.url || null,
                telegram: mainPair.info?.socials?.find(s => s.type === 'telegram')?.url || null,
                website: mainPair.info?.websites?.[0]?.url || null
            },
            launchInfo: {
                creationTime: Math.floor(mainPair.pairCreatedAt / 1000)
            },
            pool: {
                address: mainPair.pairAddress,
                labels: mainPair.labels || []
            },
            source: 'dexscreener'
        };
    }

    async getTokensInfo(mintAddresses) {
        const results = [];
        for (const mintAddress of mintAddresses) {
            const info = await this.getTokenInfo(mintAddress);
            if (info) {
                results.push({
                    mint: mintAddress,
                    ...info
                });
            }
        }
        return results.sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0));
    }
}

module.exports = new TokenInfoFetcher();