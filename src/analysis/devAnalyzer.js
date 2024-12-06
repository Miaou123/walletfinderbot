const { analyzeFunding } = require('../tools/fundingAnalyzer');
const pumpfunApi = require('../integrations/pumpfunApi');
const gmgnApi = require('../integrations/gmgnApi');
const { getSolanaApi } = require('../integrations/solanaApi');
const tokenInfoFetcher = require('../tools/tokenInfoFetcher');
const BigNumber = require('bignumber.js');
const { getAssetsForMultipleWallets } = require('../tools/walletValueCalculator');
const logger = require('../utils/logger');

const EXCHANGE_ADDRESSES = {
    '45ruCyfdRkWpRNGEqWzjCiXRHkZs8WXCLQ67Pnpye7Hp': 'Jupiter Partner Referral Fee Vault',
    'GugU1tP7doLeTw9hQP51xRJyS8Da1fWxuiy2rVrnMD2m': 'Wormhole Custody Authority',
    'GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL': 'Wormhole Custody Authority',
    '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1': 'Raydium v4',
    '2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S': 'Binance 1',
    '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9': 'Binance 2',
    'AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2': 'Bybit',
    'u6PJ8DtQuPFnfmwHbGFULQ4u4EgjDiyYKjVEsynXq2w': 'Gate.io',
    'HiRpdAZifEsZGdzQ5Xo5wcnaH3D2Jj9SoNsUzcYNK78J': 'Gate.io 2',
    '5VCwKtCXgCJ6kit5FybXjvriW3xELsFDhYrPSqtJNmcD': 'OKX',
    '9un5wqE3q4oCjyrDkwsdD48KteCJitQX5978Vh7KKxHo': 'OKX 2',
    'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE': 'Coinbase',
    'H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS': 'Coinbase',
    '2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm': 'Coinbase 2',
    '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM': 'Binance 3',
    'BmFdpraQhkiDQE6SnfG5omcA1VwzqfXrwtNYBwWTymy6': 'KuCoin',
    'HVh6wHNBAsG3pq1Bj5oCzRjoWKVogEDHwUHkRz3ekFgt': 'KuCoin',
    'HWEoBxYs7ssKuudEjzjmpfJVX7Dvi7wescFsVx2L5yoY': 'bloxroute'
};

class DevAnalyzer {
    constructor() {
        this.solanaApi = getSolanaApi();
        this.pumpFunApi = pumpfunApi;
        this.gmgnApi = gmgnApi;
        this.tokenInfoFetcher = tokenInfoFetcher;
        logger.info('DevAnalyzer initialized');
    }

    async analyzeDevProfile(tokenAddress) {
        try {
            logger.debug(`Starting analysis for token: ${tokenAddress}`);
    
            const tokenInfo = await this.tokenInfoFetcher.getTokenInfo(tokenAddress);
            logger.debug('Token info retrieved:', { tokenInfo });
    
            const devAddress = await this.findDevAddress(tokenAddress);
            logger.info('Found dev address:', { devAddress });
    
            const createdCoins = await this.getAllCreatedCoins(devAddress);
            logger.debug('Created coins:', { createdCoins });
            
            const coinsStats = this.analyzeCoinsStats(createdCoins);
            logger.debug('Coins stats:', { coinsStats });
            
            logger.debug('Fetching bonded coins info...');
            const bondedCoinsInfo = await this.getBondedCoinsInfo(createdCoins);
            logger.debug('Bonded coins info:', { bondedCoinsInfo });
            
            const fundingInfo = await analyzeFunding([{ address: devAddress }]);
            logger.debug('Funding info:', { fundingInfo });
    
            const transferConnections = await this.analyzeTransferConnections(devAddress);
    
            logger.debug('Getting wallet assets...');
            const walletAssets = await getAssetsForMultipleWallets([devAddress]);
            logger.debug('Wallet assets:', { walletAssets });
            const ownerWalletData = walletAssets[devAddress];
            logger.debug('Owner wallet data:', { ownerWalletData });
    
            let devTokenBalance = 0;
            let tokenDecimals = 0;
            if (ownerWalletData && ownerWalletData.tokenInfos) {
                const tokenData = ownerWalletData.tokenInfos.find(token => token.mint === tokenAddress);
                logger.debug('Token data from wallet:', { tokenData });
                if (tokenData) {
                    devTokenBalance = parseFloat(tokenData.balance);
                    tokenDecimals = tokenData.decimals || 0;
                }
            }
    
            const tokenSupplyInfo = await this.solanaApi.getTokenSupply(tokenAddress);
            logger.debug('Token supply info:', { tokenSupplyInfo });
            let totalSupply = 0;
            if (tokenSupplyInfo?.value?.amount) {
                totalSupply = new BigNumber(tokenSupplyInfo.value.amount)
                    .dividedBy(Math.pow(10, tokenSupplyInfo.value.decimals || 0))
                    .toNumber();
            }
    
            let holdingPercentage = 0;
            if (totalSupply > 0) {
                holdingPercentage = (devTokenBalance / totalSupply) * 100;
            }
    
            const ownerTokenStats = {
                devTokenBalance,
                totalSupply,
                holdingPercentage: holdingPercentage.toFixed(2)
            };
            logger.debug('Owner token stats:', { ownerTokenStats });
    
            const ownerPortfolio = await this.prepareOwnerPortfolio(ownerWalletData);
            logger.debug('Final owner portfolio:', { ownerPortfolio });
    
            const finalAnalysis = {
                tokenAddress,
                tokenSymbol: tokenInfo.symbol,
                devAddress,
                coinsStats,
                bondedCoinsInfo: bondedCoinsInfo || { topPerformers: [] },
                fundingInfo: fundingInfo[0] ? {
                    funderAddress: fundingInfo[0].funderAddress,
                    amount: await this.getFundingAmount(devAddress, fundingInfo[0].funderAddress),
                    timestamp: await this.getFundingTimestamp(devAddress, fundingInfo[0].funderAddress),
                    label: EXCHANGE_ADDRESSES[fundingInfo[0].funderAddress]
                } : null,
                transferConnections,
                ownerTokenStats,
                ownerPortfolio: ownerPortfolio || { topTokens: [] },
                success: true
            };
            
            logger.debug('Final analysis object:', { finalAnalysis });
            return finalAnalysis;
    
        } catch (error) {
            logger.error('Error in analyzeDevProfile:', { error: error.message });
            return {
                tokenAddress,
                success: false,
                error: error.message
            };
        }
    }

    async findDevAddress(tokenAddress) {
        try {
            let offset = 0;
            const limit = 200;
            let oldestTx = null;
            let hasMore = true;
            let totalTrades = 0;

            logger.debug('Starting to fetch trades for token:', { tokenAddress });
            
            while (hasMore) {
                const trades = await this.pumpFunApi.getAllTrades(tokenAddress, limit, offset);
                
                if (!trades || trades.length === 0) {
                    logger.debug('No more trades found');
                    hasMore = false;
                    break;
                }

                totalTrades += trades.length;
                //logger.debug('Fetched trades info:', { count: trades.length, totalTrades });

                trades.forEach(trade => {
                    if (!oldestTx || trade.timestamp < oldestTx.timestamp) {
                        oldestTx = trade;
                    }
                });

                if (trades.length < limit) {
                    logger.debug('Reached end of trades (less than limit returned)');
                    hasMore = false;
                } else {
                    offset += limit;
                }
            }

            if (!oldestTx) {
                logger.error('No trades found for token:', { tokenAddress });
                throw new Error("No trades found for this token");
            }

            logger.info('Found oldest transaction:', { 
                user: oldestTx.user, 
                timestamp: oldestTx.timestamp 
            });

            this.initialBuy = {
                user: oldestTx.user,
                tokenAmount: oldestTx.token_amount,
                timestamp: oldestTx.timestamp
            };

            return oldestTx.user;
        } catch (error) {
            logger.error('Error finding dev address:', { 
                tokenAddress, 
                error: error.message 
            });
            throw error;
        }
    }

    async getAllCreatedCoins(address) {
        try {
            let offset = 0;
            const limit = 10; // On garde la limite à 10 comme dans l'API
            let allCoins = [];
            let hasMore = true;
    
            logger.debug('Starting to fetch created coins for address:', { address });
            
            while (hasMore) {
                logger.debug('Fetching created coins with offset:', { offset });
                const coins = await this.pumpFunApi.getCreatedCoins(address, limit, offset);
                
                if (!coins || !Array.isArray(coins) || coins.length === 0) {
                    logger.debug('No more created coins found');
                    hasMore = false;
                    break;
                }
    
                allCoins = [...allCoins, ...coins];
                logger.debug('Fetched created coins:', { 
                    count: coins.length, 
                    totalSoFar: allCoins.length 
                });
                
                if (coins.length < limit) {
                    logger.debug('Reached end of created coins (less than limit returned)');
                    hasMore = false;
                } else {
                    offset += limit;
                }
            }
    
            return allCoins;
        } catch (error) {
            logger.error('Error fetching all created coins:', {
                address,
                error: error.message
            });
            return [];
        }
    }

    async getTokenDecimals(tokenAddress) {
        try {
            const tokenSupply = await this.solanaApi.getTokenSupply(tokenAddress);
            if (tokenSupply && tokenSupply.value && tokenSupply.value.decimals !== undefined) {
                return tokenSupply.value.decimals;
            }
        } catch (error) {
            logger.error('Error fetching token decimals:', { 
                tokenAddress, 
                error: error.message 
            });
        }
        return 0;
    }

    async prepareOwnerPortfolio(ownerWalletData) {
        try {
            logger.debug('Preparing owner portfolio with data:', { ownerWalletData });
            
            if (!ownerWalletData) {
                logger.warn('No owner wallet data provided');
                return {
                    portfolioValueUsd: 0,
                    solBalance: 0,
                    topTokens: []
                };
            }
    
            const portfolioValueUsd = parseFloat(ownerWalletData.totalValue || 0);
            const solBalance = parseFloat(ownerWalletData.solBalance || 0);
            const topTokens = ownerWalletData.tokenInfos 
                ? ownerWalletData.tokenInfos
                    .filter(token => token && token.valueNumber > 0)
                    .sort((a, b) => (b.valueNumber || 0) - (a.valueNumber || 0))
                    .slice(0, 3)
                : [];
    
            logger.debug('Prepared portfolio:', { portfolioValueUsd, solBalance, topTokens });
    
            return {
                portfolioValueUsd,
                solBalance,
                topTokens
            };
        } catch (error) {
            logger.error('Error preparing owner portfolio:', { error: error.message });
            return {
                portfolioValueUsd: 0,
                solBalance: 0,
                topTokens: []
            };
        }
    }

    async getFundingAmount(address, funderAddress) {
        try {
            const sigs = await this.solanaApi.getSignaturesForAddress(address, { limit: 100 });
            for (const sig of sigs) {
                const tx = await this.solanaApi.getTransaction(sig.signature);
                if (this.isTransferTransaction(tx)) {
                    const details = this.getTransferDetails(tx, address);
                    if (details && details.counterparty === funderAddress) {
                        return details.amount;
                    }
                }
            }
            return null;
        } catch (error) {
            logger.error('Error getting funding amount:', { error: error.message });
            return null;
        }
    }

    async getFundingTimestamp(address, funderAddress) {
        try {
            const sigs = await this.solanaApi.getSignaturesForAddress(address, { limit: 100 });
            for (const sig of sigs) {
                const tx = await this.solanaApi.getTransaction(sig.signature);
                if (this.isTransferTransaction(tx)) {
                    const details = this.getTransferDetails(tx, address);
                    if (details && details.counterparty === funderAddress) {
                        return details.timestamp;
                    }
                }
            }
            return null;
        } catch (error) {
            logger.error('Error getting funding timestamp:', { error: error.message });
            return null;
        }
    }

    async getBondedCoinsInfo(coins) {
        logger.debug('Starting to get bonded coins info');
        if (!Array.isArray(coins)) {
            logger.warn('getBondedCoinsInfo received invalid coins array');
            return {
                allBondedCoins: [],
                topPerformers: []
            };
        }
    
        const bondedCoins = coins.filter(coin => coin.complete === true);
        logger.debug('Found bonded coins:', { count: bondedCoins.length });
    
        try {
            logger.debug('Fetching detailed info for each bonded coin...');
            const coinsInfo = await this.tokenInfoFetcher.getTokensInfo(
                bondedCoins.map(coin => coin.mint)
            );
            logger.debug('Retrieved info for coins:', { count: coinsInfo.length });
    
            if (!Array.isArray(coinsInfo)) {
                logger.warn('getTokensInfo returned invalid data');
                return {
                    allBondedCoins: [],
                    topPerformers: []
                };
            }
    
            const validCoins = coinsInfo
                .filter(coin => coin && coin.marketCap)
                .sort((a, b) => b.marketCap - a.marketCap);
    
            const topPerformers = validCoins.slice(0, 3);
    
            if (topPerformers.length > 0) {
                logger.info('Top performer marketcap:', { 
                    marketCap: topPerformers[0].marketCap 
                });
            }
    
            return {
                allBondedCoins: validCoins,
                topPerformers
            };
        } catch (error) {
            logger.error('Error in getBondedCoinsInfo:', { error: error.message });
            return {
                allBondedCoins: [],
                topPerformers: []
            };
        }
    }

    async analyzeTransferConnections(address) {
        try {
            logger.debug('Fetching signatures for address:', { address });
            const signatures = await this.solanaApi.getSignaturesForAddress(address, { limit: 500 });
            logger.debug('Retrieved signatures:', { count: signatures.length });
        
            const transferConnectionsMap = new Map();
        
            const signatureChunks = this.chunkArray(signatures, 5);
            for (const chunk of signatureChunks) {
                const txPromises = chunk.map(async (sig) => {
                    try {
                        const tx = await this.solanaApi.getTransaction(sig.signature);
        
                        if (this.isTransferTransaction(tx)) {
                            const connection = this.getTransferDetails(tx, address);
                            if (connection) {
                                const { counterparty, amount, timestamp } = connection;
                                const label = EXCHANGE_ADDRESSES[counterparty];
                                
                                if (!transferConnectionsMap.has(counterparty) ||
                                    transferConnectionsMap.get(counterparty).amount < amount) {
                                    transferConnectionsMap.set(counterparty, {
                                        address: counterparty,
                                        amount,
                                        timestamp,
                                        label,
                                        date: new Date(timestamp * 1000).toISOString()
                                    });
                                }
                            }
                        }
                    } catch (error) {
                        logger.error('Error analyzing transaction:', { 
                            signature: sig.signature,
                            error: error.message
                        });
                    }
                });
        
                await Promise.all(txPromises);
            }
        
            let transferConnections = Array.from(transferConnectionsMap.values());
            const significantConnections = [];

            for (const conn of transferConnections) {
                let isSignificant = false;

                // 1. Vérifier le montant
                if (conn.amount > 0.1) {
                    isSignificant = true;
                    // On ne met pas de continue ici pour vérifier les autres conditions
                }

                // 2. Vérifier portfolio et coins pour tous les wallets non-exchange
                if (!EXCHANGE_ADDRESSES[conn.address]) {
                    // Vérifier le portfolio
                    const walletData = await this.gmgnApi.getWalletData(conn.address);
                    const portfolioValue = walletData?.data?.total_value;
                    
                    if (portfolioValue && parseFloat(portfolioValue) > 10000) {
                        conn.walletDetails = {
                            portfolioValue: portfolioValue,
                            totalCoinsCreated: 0,
                            bondedCoinsCount: 0
                        };
                        isSignificant = true;
                    }

                    // Toujours vérifier les coins créés
                    const createdCoins = await this.getAllCreatedCoins(conn.address);
                    if (createdCoins && createdCoins.length > 0) {
                        const bondedCoins = createdCoins.filter(coin => coin.complete === true);
                        
                        if (conn.walletDetails) {
                            // Mettre à jour les détails existants
                            conn.walletDetails.totalCoinsCreated = createdCoins.length;
                            conn.walletDetails.bondedCoinsCount = bondedCoins.length;
                        } else {
                            // Créer les détails s'ils n'existent pas
                            conn.walletDetails = {
                                portfolioValue: portfolioValue || 0,
                                totalCoinsCreated: createdCoins.length,
                                bondedCoinsCount: bondedCoins.length
                            };
                        }
                        isSignificant = true;
                    }
                }

                if (isSignificant) {
                    significantConnections.push(conn);
                }
            }
    
            // Trier par montant
            significantConnections.sort((a, b) => b.amount - a.amount);
        
            logger.info('Found significant transfer connections:', { 
                count: significantConnections.length 
            });
            return significantConnections;
                
        } catch (error) {
            logger.error('Error in analyzeTransferConnections:', { 
                error: error.message 
            });
            return [];
        }
    }


    getTransferDetails(tx, address) {
        const instruction = tx.transaction.message.instructions.find(i => 
            i.program === 'system' && 
            i.parsed?.type === 'transfer'
        );
        
        if (!instruction || !instruction.parsed?.info) return null;
        
        const { source, destination, lamports } = instruction.parsed.info;
        if (source === address || destination === address) {
            return {
                counterparty: source === address ? destination : source,
                amount: lamports / 1e9,
                timestamp: tx.blockTime
            };
        }
        return null;
    }

    analyzeCoinsStats(coins) {
        if (!Array.isArray(coins)) {
            logger.warn('No valid coins array provided:', { coins });
            return {
                totalCoins: 0,
                bondedCount: 0,
                bondedPercentage: "0.00",
                bondedCoins: []
            };
        }
    
        const totalCoins = coins.length;
        const bondedCoins = coins.filter(coin => coin.complete === true);
        const bondedCount = bondedCoins.length;
        const bondedPercentage = totalCoins > 0 ? (bondedCount / totalCoins) * 100 : 0;
    
        return {
            totalCoins,
            bondedCount,
            bondedPercentage: bondedPercentage.toFixed(2),
            bondedCoins
        };
    }

    isTransferTransaction(tx) {
        if (!tx || !tx.transaction || !tx.transaction.message) return false;
        const instructions = tx.transaction.message.instructions;
        return instructions.some(instruction => 
            instruction.program === 'system' && 
            instruction.parsed?.type === 'transfer'
        );
    }

    chunkArray(array, size) {
        const result = [];
        for (let i = 0; i < array.length; i += size) {
            result.push(array.slice(i, i + size));
        }
        return result;
    }
}

module.exports = new DevAnalyzer();