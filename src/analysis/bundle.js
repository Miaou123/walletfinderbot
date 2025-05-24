const pumpfunApi = require('../integrations/pumpfunApi');
const dexscreenerApi = require('../integrations/dexScreenerApi');
const { getSolanaApi } = require('../integrations/solanaApi');
const gmgnApi = require('../integrations/gmgnApi');
const { analyzeFunding } = require('../tools/fundingAnalyzer');
const config = require('../utils/config');
const logger = require('../utils/logger');
const BigNumber = require('bignumber.js');

class UnifiedBundleAnalyzer {
    constructor() {
        this.logger = logger;
        this.gmgnApi = gmgnApi;
        this.txHashes = new Set();
        this.FRESH_WALLET_THRESHOLD = 10;
        this.TOKEN_THRESHOLD = 2;
        this.TOKEN_DECIMALS = config.PUMPFUN_DECIMALS;
        this.SOL_DECIMALS = config.SOL_DECIMALS;
        this.TOKEN_FACTOR = Math.pow(10, this.TOKEN_DECIMALS);
        this.SOL_FACTOR = Math.pow(10, this.SOL_DECIMALS);
    }

    // Modifiez le getTokenInfo existant pour utiliser getTokenMetadata
    async getTokenInfo(address) {
        try {
            const tokenInfo = await this.getTokenMetadata(address, 'bundle', 'getTokenInfo');
            return {
                name: tokenInfo.symbol, // On utilise symbol comme name par défaut
                symbol: tokenInfo.symbol,
                total_supply: tokenInfo.totalSupply,
                decimals: tokenInfo.decimals,
                price: tokenInfo.priceUsd,
                address: tokenInfo.address // Important pour les liens
            };
        } catch (error) {
            logger.error(`Error in getTokenInfo: ${error.message}`);
            throw error;
        }
    }

    async getTokenMetadata(tokenAddress, mainContext, subContext) {
        try {
            logger.debug('Fetching token metadata from Helius API...');
            const solanaApi = getSolanaApi();
            
            // Récupérer les infos du token et de SOL en parallèle
            const [tokenAsset, solAsset] = await Promise.all([
                solanaApi.getAsset(tokenAddress, mainContext, `${subContext}_token`),
                solanaApi.getAsset(
                    "So11111111111111111111111111111111111111112",
                    mainContext,
                    `${subContext}_sol`
                )
            ]);
    
            logger.debug(`Processing token asset:`, tokenAsset);
            logger.debug(`Processing SOL asset:`, solAsset);
    
            if (!tokenAsset) {
                logger.error('Token asset missing:', tokenAsset);
                throw new Error('Token metadata not found');
            }
    
            // Utiliser directement les données formatées par getAsset
            const tokenPrice = tokenAsset.price || 0;
            const solPrice = solAsset?.price || 0;
    
            const result = {
                decimals: tokenAsset.decimals || 0,
                symbol: tokenAsset.symbol || 'Unknown',
                priceUsd: tokenPrice,
                solPriceUsd: solPrice,
                priceInSol: tokenPrice && solPrice ? 
                    new BigNumber(tokenPrice)
                        .div(solPrice)
                        .toNumber() : 0,
                address: tokenAddress,
                totalSupply: tokenAsset.supply?.total ? 
                    new BigNumber(tokenAsset.supply.total).toNumber() : 0
            };
    
            logger.debug('Processed token metadata:', result);
            return result;
    
        } catch (error) {
            logger.error(`Error fetching token metadata for ${tokenAddress}:`, error);
            throw error;
        }
    }

    async isPumpfunCoin(address) {
        try {
            const trades = await pumpfunApi.getAllTrades(address, 1, 0);
            return Array.isArray(trades);
        } catch (error) {
            logger.debug(`Token ${address} not found in PumpFun API: ${error.message}`);
            return false;
        }
    }

    async analyzeBundle(address, limit = 50000, isTeamAnalysis = false) {
        const isPumpfun = await this.isPumpfunCoin(address);
        if (isPumpfun) {
            return this.analyzePumpfunBundle(address, limit, isTeamAnalysis);
        } else {
            return this.analyzeNonPumpfunBundle(address);
        }
    }

    async analyzePumpfunBundle(address, limit, isTeamAnalysis) {
        let offset = 0;
        const pageLimit = 200;
        let hasMoreTransactions = true;
        const allTrades = [];

        while (hasMoreTransactions) {
            logger.debug(`Fetching trades from Pumpfun API. Offset: ${offset}, Limit: ${pageLimit}`);
            const trades = await pumpfunApi.getAllTrades(address, pageLimit, offset);

            if (trades && trades.length > 0) {
                allTrades.push(...trades);
                logger.debug(`Total trades fetched so far: ${allTrades.length}`);
                offset += pageLimit;

                if (allTrades.length >= limit) {
                    logger.debug(`Reached specified limit of ${limit} trades. Stopping pagination.`);
                    hasMoreTransactions = false;
                }
            } else {
                hasMoreTransactions = false;
                logger.debug('No more trades found from Pumpfun API');
            }
        }

        logger.debug(`Total trades fetched: ${allTrades.length}`);

        const bundles = {};

        allTrades.forEach(trade => {
            if (trade.is_buy) {
                if (!bundles[trade.slot]) {
                    bundles[trade.slot] = {
                        uniqueWallets: new Set(),
                        tokensBought: 0,
                        solSpent: 0,
                        transactions: []
                    };
                }
                bundles[trade.slot].uniqueWallets.add(trade.user);
                const tokenAmount = trade.token_amount / this.TOKEN_FACTOR;
                bundles[trade.slot].tokensBought += tokenAmount;
                bundles[trade.slot].solSpent += trade.sol_amount / this.SOL_FACTOR;
                bundles[trade.slot].transactions.push(trade);
            }
        });

        const filteredBundles = Object.entries(bundles)
            .filter(([_, bundle]) => bundle.uniqueWallets.size >= 2)
            .map(([slot, bundle]) => ({
                slot: parseInt(slot),
                uniqueWallets: bundle.uniqueWallets,
                uniqueWalletsCount: bundle.uniqueWallets.size,
                tokensBought: bundle.tokensBought,
                solSpent: bundle.solSpent,
                transactions: bundle.transactions
            }))
            .sort((a, b) => b.tokensBought - a.tokensBought);

        const tokenInfo = await this.getTokenInfo(address);

        logger.debug(`Token info: ${JSON.stringify(tokenInfo)}`);

        const totalSupply = parseFloat(tokenInfo.total_supply);

        if (isTeamAnalysis) {
            return this.performTeamAnalysis(filteredBundles, tokenInfo, totalSupply);
        } else {
            return this.performRegularAnalysis(filteredBundles, tokenInfo, totalSupply, address);
        }
    }

    async performTeamAnalysis(filteredBundles, tokenInfo, totalSupply) {
        const teamWallets = new Set();
        const allWallets = new Set(filteredBundles.flatMap(bundle => Array.from(bundle.uniqueWallets)));

        const walletsToAnalyze = Array.from(allWallets).map(address => ({ address }));
        const fundingResults = await analyzeFunding(walletsToAnalyze, 'bundle', 'teamAnalysis');

        const funderMap = new Map();

        for (const result of fundingResults) {
            const { address, funderAddress } = result;
            if (funderAddress) {
                if (!funderMap.has(funderAddress)) {
                    funderMap.set(funderAddress, new Set());
                }
                funderMap.get(funderAddress).add(address);
            }

            if (await this.isTeamWallet(address, funderAddress)) {
                teamWallets.add(address);
            }
        }

        for (const [funder, wallets] of funderMap.entries()) {
            if (wallets.size > 1) {
                for (const wallet of wallets) {
                    teamWallets.add(wallet);
                }
            }
        }

        const teamBundles = filteredBundles.map(bundle => {
            const teamWalletsInBundle = Array.from(bundle.uniqueWallets).filter(wallet => teamWallets.has(wallet));
            if (teamWalletsInBundle.length > 0) {
                return {
                    ...bundle,
                    uniqueWallets: new Set(teamWalletsInBundle),
                    uniqueWalletsCount: teamWalletsInBundle.length,
                    tokensBought: bundle.transactions
                        .filter(tx => teamWalletsInBundle.includes(tx.user))
                        .reduce((sum, tx) => sum + tx.token_amount / this.TOKEN_FACTOR, 0),
                    solSpent: bundle.transactions
                        .filter(tx => teamWalletsInBundle.includes(tx.user))
                        .reduce((sum, tx) => sum + tx.sol_amount / this.SOL_FACTOR, 0)
                };
            }
            return null;
        }).filter(bundle => bundle !== null);

        const totalTokensBundled = teamBundles.reduce((sum, bundle) => sum + bundle.tokensBought, 0);
        const totalSolSpent = teamBundles.reduce((sum, bundle) => sum + bundle.solSpent, 0);

        const teamHoldings = await this.calculateTeamHoldings(Array.from(teamWallets), tokenInfo.address, tokenInfo.decimals);

        const percentageBundled = (totalTokensBundled / totalSupply) * 100;
        const totalHoldingAmountPercentage = (teamHoldings.totalHoldingAmount / totalSupply) * 100;

        return {
            totalTeamWallets: teamWallets.size,
            totalTokensBundled,
            percentageBundled,
            totalSolSpent,
            totalHoldingAmount: teamHoldings.totalHoldingAmount,
            totalHoldingAmountPercentage,
            teamBundles,
            tokenInfo,
            isTeamAnalysis: true
        };
    }

    async performRegularAnalysis(filteredBundles, tokenInfo, totalSupply, address) {
        const totalTokensBundled = filteredBundles.reduce((sum, bundle) => sum + bundle.tokensBought, 0);
        const totalSolSpent = filteredBundles.reduce((sum, bundle) => sum + bundle.solSpent, 0);
        
        // FIX: Add missing percentageBundled calculation
        const percentageBundled = (totalTokensBundled / totalSupply) * 100;
        
        logger.debug(`=== BUNDLE ANALYSIS DEBUG ===`);
        logger.debug(`Total bundles found: ${filteredBundles.length}`);
        logger.debug(`Total tokens bundled: ${totalTokensBundled}`);
        logger.debug(`Total supply: ${totalSupply}`);
        
        const allBundles = await Promise.all(filteredBundles.map(async (bundle, index) => {
            try {
                logger.debug(`\n--- Processing Bundle ${index + 1} (Slot ${bundle.slot}) ---`);
                logger.debug(`Wallets in bundle: ${Array.from(bundle.uniqueWallets).join(', ')}`);
                logger.debug(`Tokens bought: ${bundle.tokensBought}`);
                
                const holdingAmounts = await Promise.all(
                    Array.from(bundle.uniqueWallets).map(async (wallet) => {
                        try {
                            // Get token accounts with parsed data that includes balances
                            const tokenAccounts = await getSolanaApi().getTokenAccountsByOwner(wallet, address);
                            
                            // Sum up balances directly from the tokenAccount data
                            const walletHolding = tokenAccounts.reduce((sum, account) => {
                                // Extract amount from parsed account data
                                const amount = account.account?.data?.parsed?.info?.tokenAmount?.amount;
                                if (amount) {
                                    return sum + BigInt(amount);
                                }
                                return sum;
                            }, BigInt(0));
                            
                            const walletHoldingNumber = Number(walletHolding) / Math.pow(10, tokenInfo.decimals);
                            logger.debug(`  Wallet ${wallet}: ${walletHoldingNumber} tokens`);
                            
                            return walletHolding;
                        } catch (error) {
                            logger.warn(`Error processing wallet ${wallet}: ${error.message}`);
                            return BigInt(0);
                        }
                    })
                );

                const totalHolding = holdingAmounts.reduce((sum, amount) => sum + amount, BigInt(0));
                const totalHoldingNumber = Number(totalHolding) / Math.pow(10, tokenInfo.decimals);
                const holdingPercentage = (totalHoldingNumber / totalSupply) * 100;
                
                logger.debug(`Bundle ${index + 1} total holding: ${totalHoldingNumber} (${holdingPercentage.toFixed(4)}%)`);

                return {
                    ...bundle,
                    holdingAmount: totalHoldingNumber,
                    holdingPercentage: holdingPercentage
                };
            } catch (error) {
                logger.error(`Error processing bundle ${index}: ${error.message}`);
                return {
                    ...bundle,
                    holdingAmount: 0,
                    holdingPercentage: 0,
                    error: error.message
                };
            }
        }));

        // Log final calculations
        const totalHoldingAmount = allBundles.reduce((sum, bundle) => sum + bundle.holdingAmount, 0);
        const totalHoldingAmountPercentage = (totalHoldingAmount / totalSupply) * 100;
        
        logger.debug(`\n=== FINAL TOTALS ===`);
        logger.debug(`Total holding amount calculated: ${totalHoldingAmount}`);
        logger.debug(`Total holding percentage: ${totalHoldingAmountPercentage}%`);
        
        // Sort bundles and log the sorting
        const sortedBundlesByTokensBought = [...allBundles].sort((a, b) => b.tokensBought - a.tokensBought);
        logger.debug(`\n=== TOP 10 BUNDLES BY TOKENS BOUGHT ===`);
        sortedBundlesByTokensBought.slice(0, 10).forEach((bundle, index) => {
            logger.debug(`${index + 1}. Slot ${bundle.slot}: ${bundle.tokensBought} tokens bought, ${bundle.holdingAmount} holding (${bundle.holdingPercentage?.toFixed(4)}%)`);
        });
        
        // FIX: Sort by holding amount instead of tokens bought
        const sortedBundles = allBundles.sort((a, b) => {
            // First sort by holding amount (descending)
            const holdingDiff = (b.holdingAmount || 0) - (a.holdingAmount || 0);
            if (holdingDiff !== 0) return holdingDiff;
            
            // If holding amounts are equal, fallback to tokens bought
            return b.tokensBought - a.tokensBought;
        });
        
        logger.debug(`\n=== TOP 10 BUNDLES BY HOLDING AMOUNT ===`);
        sortedBundles.slice(0, 10).forEach((bundle, index) => {
            logger.debug(`${index + 1}. Slot ${bundle.slot}: ${bundle.holdingAmount} holding (${bundle.holdingPercentage?.toFixed(4)}%), ${bundle.tokensBought} tokens bought`);
        });

        return {
            totalBundles: filteredBundles.length,
            totalTokensBundled,
            percentageBundled, // Now properly defined
            totalSolSpent,
            totalHoldingAmount,
            totalHoldingAmountPercentage,
            allBundles: sortedBundles, // FIX: Use holding-based sorting
            tokenInfo,
            isTeamAnalysis: false
        };
    }

     async analyzeNonPumpfunBundle(address) {
        this.logger.info(`Starting analysis for non-Pumpfun token: ${address}`);
        
        try {
            // Fetch token info
            const tokenInfo = await this.getTokenInfo(address);
            if (!tokenInfo || !tokenInfo.data || !tokenInfo.data.token) {
                throw new Error('Invalid token info structure');
            }
            const totalSupply = tokenInfo.total_supply;
            this.logger.info(`Total supply for ${address}: ${totalSupply}`);

            // Fetch and analyze transactions
            const tradesResponse = await this.gmgnApi.getAllTransactions(address, 'bundleCheck', null, null, 100, true);
            
            // Ensure trades is an array
            const trades = Array.isArray(tradesResponse) ? tradesResponse : tradesResponse.data?.history || [];

            this.logger.debug(`Fetched ${trades.length} trades for analysis`);

            const bundleData = this.checkBundle(trades, totalSupply);
            
            this.logger.info(`Bundle analysis completed for ${address}`);    
            return {
                ...bundleData,
                tokenInfo, 
                totalSupply
            };
        } catch (error) {
            this.logger.error(`Error in analyzeNonPumpfunBundle for address ${address}: ${error.message}`);
            throw error;
        }
    }


    checkBundle(trades, totalSupply) {
        this.logger.info(`Starting bundle check`);
        this.logger.info(`Total supply: ${totalSupply}`);

        const data = {
            bundles: [],
            totalTokenAmount: 0,
            totalSolAmount: 0,
            bundleDetected: false,
            transactionDetails: {},
            developerInfo: {}
        };

        // Group trades by timestamp
        const tradesByTimestamp = trades.reduce((acc, trade) => {
            if (!acc[trade.timestamp]) {
                acc[trade.timestamp] = [];
            }
            acc[trade.timestamp].push(trade);
            return acc;
        }, {});

        let bundleCount = 0;

        for (const [timestamp, timestampTrades] of Object.entries(tradesByTimestamp)) {
            if (timestampTrades.length > 1) {
                bundleCount++;
                const bundle = {
                    timestamp: parseInt(timestamp),
                    trades: timestampTrades,
                    tokenAmount: 0,
                    solAmount: 0
                };

                timestampTrades.forEach(trade => {
                    if (trade.event === 'buy') {
                        bundle.tokenAmount += trade.base_amount;
                        bundle.solAmount += trade.quote_amount;
                        data.totalTokenAmount += trade.base_amount;
                        data.totalSolAmount += trade.quote_amount;

                        data.transactionDetails[trade.tx_hash] = {
                            tokenAmounts: [trade.base_amount],
                            solAmounts: [trade.quote_amount],
                            tokenAmountsPercentages: [(trade.base_amount / totalSupply) * 100],
                            walletAddress: trade.maker
                        };
                    }
                });

                data.bundles.push(bundle);
            }
        }

        data.bundleDetected = bundleCount > 0;
        data.developerInfo = {
            bundledTokenAmount: data.totalTokenAmount,
            bundledSolAmount: data.totalSolAmount,
            percentageOfSupply: (data.totalTokenAmount / totalSupply) * 100
        };

        this.logger.info(`Bundle check completed. Bundles detected: ${bundleCount}, Total token amount: ${data.totalTokenAmount}, Total SOL amount: ${data.totalSolAmount}`);
        this.logger.info(`Developer info: Bundled token amount: ${data.developerInfo.bundledTokenAmount}, Bundled SOL amount: ${data.developerInfo.bundledSolAmount}, Percentage of supply: ${data.developerInfo.percentageOfSupply}%`);

        return data;
    }
    
    formatTokens(amount, decimals) {
        return parseFloat(amount) / Math.pow(10, decimals);
    }
    
    formatSol(amount) {
        return parseFloat(amount) / 1e9; // 1e9 lamports = 1 SOL
    }
    
    
    formatTokens(amount, decimals) {
        return parseFloat(amount) / Math.pow(10, decimals);
    }
    
    formatSol(amount) {
        return parseFloat(amount) / 1e9; // 1e9 lamports = 1 SOL
    }

    async isTeamWallet(address, funderAddress) {
        if (await this.isFreshWallet(address, 'bundle', 'teamAnalysis')) {
            logger.debug(`${address} is a fresh wallet, considered as team wallet`);
            return true;
        }

        if (funderAddress) {
            logger.debug(`${address} has funder ${funderAddress}`);
        }

        logger.debug(`${address} is not considered as a team wallet`);
        return false;
    }

    async isFreshWallet(address, mainContext, subContext) {
        try {
            const solanaApi = getSolanaApi();
            const signatures = await solanaApi.getSignaturesForAddress(address, { limit: this.FRESH_WALLET_THRESHOLD }, mainContext, subContext);
            return signatures.length <= this.FRESH_WALLET_THRESHOLD;
        } catch (error) {
            logger.error(`Error checking if ${address} is a fresh wallet:`, error);
            return false;
        }
    }

    async calculateTeamHoldings(teamWallets, tokenAddress, tokenDecimals) {
        const solanaApi = getSolanaApi();
        let totalHoldingAmount = 0;
    
        for (const wallet of teamWallets) {
            try {
                // Get token accounts with parsed data that includes balances
                const tokenAccounts = await solanaApi.getTokenAccountsByOwner(wallet, tokenAddress);
                
                // Sum up balances directly from the account data
                for (const account of tokenAccounts) {
                    const amount = account.account?.data?.parsed?.info?.tokenAmount?.amount;
                    if (amount) {
                        totalHoldingAmount += Number(amount) / Math.pow(10, tokenDecimals);
                    }
                }
            } catch (error) {
                logger.warn(`Error getting holdings for team wallet ${wallet}: ${error.message}`);
                // Continue with next wallet
            }
        }
    
        return { totalHoldingAmount };
    }
}

module.exports = UnifiedBundleAnalyzer;