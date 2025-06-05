const pumpfunApi = require('../integrations/pumpfunApi');
const { getSolanaApi } = require('../integrations/solanaApi');
const { analyzeFunding } = require('../tools/fundingAnalyzer');
const config = require('../utils/config');
const logger = require('../utils/logger');
const BigNumber = require('bignumber.js');

class PumpfunBundleAnalyzer {
    constructor() {
        this.logger = logger;
        this.FRESH_WALLET_THRESHOLD = 10;
        this.TOKEN_DECIMALS = config.PUMPFUN_DECIMALS;
        this.SOL_DECIMALS = config.SOL_DECIMALS;
        this.TOKEN_FACTOR = Math.pow(10, this.TOKEN_DECIMALS);
        this.SOL_FACTOR = Math.pow(10, this.SOL_DECIMALS);
    }

    async getTokenMetadata(tokenAddress, mainContext, subContext) {
        try {
            logger.debug('Fetching token metadata from Helius API...');
            const solanaApi = getSolanaApi();
            
            // Get token and SOL info in parallel
            const [tokenAsset, solAsset] = await Promise.all([
                solanaApi.getAsset(tokenAddress, mainContext, `${subContext}_token`),
                solanaApi.getAsset(
                    "So11111111111111111111111111111111111111112",
                    mainContext,
                    `${subContext}_sol`
                )
            ]);
    
            if (!tokenAsset) {
                throw new Error('Token metadata not found');
            }
    
            const tokenPrice = tokenAsset.price || 0;
            const solPrice = solAsset?.price || 0;
    
            const result = {
                decimals: tokenAsset.decimals || 0,
                symbol: tokenAsset.symbol || 'Unknown',
                name: tokenAsset.symbol || 'Unknown', // Use symbol as name
                priceUsd: tokenPrice,
                solPriceUsd: solPrice,
                priceInSol: tokenPrice && solPrice ? 
                    new BigNumber(tokenPrice).div(solPrice).toNumber() : 0,
                address: tokenAddress,
                total_supply: tokenAsset.supply?.total ? 
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
        // Check if it's a Pumpfun coin first
        const isPumpfun = await this.isPumpfunCoin(address);
        if (!isPumpfun) {
            throw new Error('This token is not a Pumpfun coin. Bundle analysis only works with Pumpfun tokens.');
        }

        return this.analyzePumpfunBundle(address, limit, isTeamAnalysis);
    }

    async analyzePumpfunBundle(address, limit, isTeamAnalysis) {
        let offset = 0;
        const pageLimit = 200;
        let hasMoreTransactions = true;
        const allTrades = [];

        // Fetch all trades from Pumpfun API
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

        // Group trades by slot to find bundles
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

        // Filter for actual bundles (2+ wallets in same slot)
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

        const tokenInfo = await this.getTokenMetadata(address, 'bundle', 'getTokenInfo');
        const totalSupply = parseFloat(tokenInfo.total_supply);

        if (isTeamAnalysis) {
            return this.performTeamAnalysis(filteredBundles, tokenInfo, totalSupply);
        } else {
            return this.performRegularAnalysis(filteredBundles, tokenInfo, totalSupply);
        }
    }

    async performTeamAnalysis(filteredBundles, tokenInfo, totalSupply) {
        const teamWallets = new Set();
        const allWallets = new Set(filteredBundles.flatMap(bundle => Array.from(bundle.uniqueWallets)));

        // Analyze funding for team detection
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

        // Mark wallets funded by same source as team wallets
        for (const [funder, wallets] of funderMap.entries()) {
            if (wallets.size > 1) {
                for (const wallet of wallets) {
                    teamWallets.add(wallet);
                }
            }
        }

        // Filter bundles for team wallets only
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

        // Calculate current team holdings
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

    async performRegularAnalysis(filteredBundles, tokenInfo, totalSupply) {
        const totalTokensBundled = filteredBundles.reduce((sum, bundle) => sum + bundle.tokensBought, 0);
        const totalSolSpent = filteredBundles.reduce((sum, bundle) => sum + bundle.solSpent, 0);
        const percentageBundled = (totalTokensBundled / totalSupply) * 100;
        
        logger.debug(`=== BUNDLE ANALYSIS DEBUG ===`);
        logger.debug(`Total bundles found: ${filteredBundles.length}`);
        logger.debug(`Total tokens bundled: ${totalTokensBundled}`);
        logger.debug(`Total supply: ${totalSupply}`);
        
        // Enhanced batch processing to handle Helius timeouts
        const BATCH_SIZE = 5; // Reduced from larger batches to prevent timeouts
        const BATCH_DELAY = 2000; // 2 second delay between batches
        const allBundles = [];
        
        for (let i = 0; i < filteredBundles.length; i += BATCH_SIZE) {
            const batch = filteredBundles.slice(i, i + BATCH_SIZE);
            
            logger.debug(`\n--- Processing Bundle Batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(filteredBundles.length/BATCH_SIZE)} ---`);
            
            // Process batch with timeout and retry
            const batchResults = await Promise.allSettled(
                batch.map((bundle, batchIndex) => 
                    this.processBundleWithRetry(bundle, i + batchIndex, tokenInfo, totalSupply)
                )
            );
            
            // Process results and handle failures gracefully
            batchResults.forEach((result, batchIndex) => {
                const bundleIndex = i + batchIndex;
                const bundle = batch[batchIndex];
                
                if (result.status === 'fulfilled' && result.value) {
                    allBundles.push(result.value);
                } else {
                    // Create fallback bundle data when API calls fail
                    logger.warn(`Bundle ${bundleIndex + 1} processing failed, using fallback data:`, {
                        error: result.reason?.message,
                        slot: bundle.slot
                    });
                    
                    allBundles.push({
                        ...bundle,
                        holdingAmount: 0,
                        holdingPercentage: 0,
                        error: `API timeout: ${result.reason?.message || 'Unknown error'}`,
                        fallback: true
                    });
                }
            });
            
            // Add delay between batches to prevent overwhelming the API
            if (i + BATCH_SIZE < filteredBundles.length) {
                logger.debug(`Waiting ${BATCH_DELAY}ms before next batch...`);
                await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
            }
        }
    
        // Calculate totals from successful bundle data only
        const successfulBundles = allBundles.filter(b => !b.error && !b.fallback);
        const failedBundles = allBundles.filter(b => b.error || b.fallback);
        
        const totalHoldingAmount = successfulBundles.reduce((sum, bundle) => sum + (bundle.holdingAmount || 0), 0);
        const totalHoldingAmountPercentage = (totalHoldingAmount / totalSupply) * 100;
        
        logger.debug(`\n=== FINAL TOTALS ===`);
        logger.debug(`Total holding amount calculated: ${totalHoldingAmount}`);
        logger.debug(`Total holding percentage: ${totalHoldingAmountPercentage}%`);
        logger.debug(`Successful bundles: ${successfulBundles.length}/${allBundles.length}`);
        
        if (failedBundles.length > 0) {
            logger.warn(`${failedBundles.length} bundles failed to process due to API timeouts`);
        }
        
        // Sort by holding amount first, then by tokens bought
        const sortedBundles = allBundles.sort((a, b) => {
            // Put successful bundles first
            if (a.error && !b.error) return 1;
            if (!a.error && b.error) return -1;
            
            const holdingDiff = (b.holdingAmount || 0) - (a.holdingAmount || 0);
            if (holdingDiff !== 0) return holdingDiff;
            return b.tokensBought - a.tokensBought;
        });
    
        return {
            totalBundles: filteredBundles.length,
            totalTokensBundled,
            percentageBundled,
            totalSolSpent,
            totalHoldingAmount,
            totalHoldingAmountPercentage,
            allBundles: sortedBundles,
            tokenInfo,
            isTeamAnalysis: false,
            // Add metadata about the analysis
            metadata: {
                successfulBundles: successfulBundles.length,
                failedBundles: failedBundles.length,
                apiTimeouts: failedBundles.filter(b => b.error?.includes('timeout')).length
            }
        };
    }
    
    // New helper method for processing individual bundles with retry
    async processBundleWithRetry(bundle, index, tokenInfo, totalSupply, maxRetries = 2) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                logger.debug(`\n--- Processing Bundle ${index + 1} (Slot ${bundle.slot}), Attempt ${attempt} ---`);
                
                const walletAddresses = Array.from(bundle.uniqueWallets);
                logger.debug(`Wallets in bundle: ${walletAddresses.join(', ')}`);
                logger.debug(`Tokens bought: ${bundle.tokensBought}`);
                
                // Use Promise.allSettled to handle individual wallet failures
                const holdingPromises = walletAddresses.map(async (wallet) => {
                    try {
                        // Add timeout for individual wallet processing
                        const timeoutPromise = new Promise((_, reject) => {
                            setTimeout(() => reject(new Error('Wallet processing timeout')), 15000); // 15s timeout per wallet
                        });
                        
                        const walletPromise = this.getWalletTokenHolding(wallet, tokenInfo);
                        
                        const result = await Promise.race([walletPromise, timeoutPromise]);
                        
                        const walletHoldingNumber = Number(result) / Math.pow(10, tokenInfo.decimals);
                        logger.debug(`  Wallet ${wallet}: ${walletHoldingNumber} tokens`);
                        
                        return result;
                    } catch (error) {
                        logger.warn(`Error processing wallet ${wallet}: ${error.message}`);
                        return BigInt(0);
                    }
                });
    
                const holdingResults = await Promise.allSettled(holdingPromises);
                
                // Extract successful results and log failures
                const holdingAmounts = holdingResults.map((result, i) => {
                    if (result.status === 'fulfilled') {
                        return result.value;
                    } else {
                        logger.debug(`Wallet ${walletAddresses[i]} failed: ${result.reason.message}`);
                        return BigInt(0);
                    }
                });
    
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
                logger.warn(`Bundle ${index + 1} processing attempt ${attempt}/${maxRetries} failed:`, error.message);
                
                if (attempt === maxRetries) {
                    throw error; // Final attempt failed
                }
                
                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
    }
    
    // Helper method to get wallet token holding with better error handling
    async getWalletTokenHolding(wallet, tokenInfo) {
        const tokenAccounts = await getSolanaApi().getTokenAccountsByOwner(wallet, tokenInfo.address);
        
        if (!Array.isArray(tokenAccounts) || tokenAccounts.length === 0) {
            return BigInt(0);
        }
        
        const walletHolding = tokenAccounts.reduce((sum, account) => {
            try {
                const amount = account.account?.data?.parsed?.info?.tokenAmount?.amount;
                if (amount && typeof amount === 'string') {
                    return sum + BigInt(amount);
                }
                return sum;
            } catch (error) {
                logger.debug(`Error processing token account for wallet ${wallet}:`, error.message);
                return sum;
            }
        }, BigInt(0));
        
        return walletHolding;
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
                const tokenAccounts = await solanaApi.getTokenAccountsByOwner(wallet, tokenAddress);
                
                for (const account of tokenAccounts) {
                    const amount = account.account?.data?.parsed?.info?.tokenAmount?.amount;
                    if (amount) {
                        totalHoldingAmount += Number(amount) / Math.pow(10, tokenDecimals);
                    }
                }
            } catch (error) {
                logger.warn(`Error getting holdings for team wallet ${wallet}: ${error.message}`);
            }
        }
    
        return { totalHoldingAmount };
    }
}

module.exports = PumpfunBundleAnalyzer;