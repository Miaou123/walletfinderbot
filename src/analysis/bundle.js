// src/analysis/bundle.js - Modified to support both PumpFun and Bonk.fun

const pumpfunApi = require('../integrations/pumpfunApi');
const { getSolanaApi } = require('../integrations/solanaApi');
const { analyzeFunding } = require('../tools/fundingAnalyzer');
const config = require('../utils/config');
const logger = require('../utils/logger');
const BigNumber = require('bignumber.js');
const { PublicKey } = require('@solana/web3.js');

class PumpfunBundleAnalyzer {
    constructor() {
        this.logger = logger;
        this.FRESH_WALLET_THRESHOLD = 10;
        this.TOKEN_DECIMALS = config.PUMPFUN_DECIMALS;
        this.SOL_DECIMALS = config.SOL_DECIMALS;
        this.TOKEN_FACTOR = Math.pow(10, this.TOKEN_DECIMALS);
        this.SOL_FACTOR = Math.pow(10, this.SOL_DECIMALS);
        
        // Bonk.fun specific constants - UPDATED
        this.BONKFUN_AUTHORITY = new PublicKey('WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh');
        this.RAYDIUM_API_BASE = 'https://launch-history-v1.raydium.io';
        
        // LaunchLab Program (bonk.fun uses this)
        this.LAUNCHLAB_PROGRAM = new PublicKey('LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj');
        
        // Standard Raydium programs
        this.RAYDIUM_AMM_PROGRAM = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
        this.RAYDIUM_CPMM_PROGRAM = new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C');
        this.RAYDIUM_CONFIG = new PublicKey('E64NGkDLLCdQ2yFNPcavaKptrEgmiQaNykUuLC1Qgwyp');
        this.SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
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
            // Quick address pattern check first
            if (!address.toLowerCase().endsWith('pump')) {
                logger.debug(`Token ${address} doesn't end with 'pump', testing with PumpFun API anyway`);
            }
    
            const trades = await pumpfunApi.getAllTrades(address, 1, 0);
            const isValid = Array.isArray(trades);
            
            if (isValid) {
                logger.debug(`Successfully verified ${address} as PumpFun token (${trades.length} trades found)`);
            } else {
                logger.debug(`Token ${address} not found in PumpFun API`);
            }
            
            return isValid;
        } catch (error) {
            logger.debug(`Token ${address} not found in PumpFun API: ${error.message}`);
            return false;
        }
    }

    async isBonkfunCoin(address) {
        try {
            // Quick address pattern check first
            if (!address.toLowerCase().endsWith('bonk')) {
                logger.debug(`Token ${address} doesn't end with 'bonk', likely not bonk.fun`);
                return false;
            }
    
            const tokenMint = new PublicKey(address);
            
            // Try all possible pool derivation methods
            const poolIds = [];
            
            // Method 1: LaunchLab derivation
            try {
                const launchpadPoolId = await this.deriveLaunchpadPoolId(tokenMint);
                if (launchpadPoolId) poolIds.push(launchpadPoolId);
            } catch (e) { /* ignore */ }
            
            // Method 2: CPMM derivation
            try {
                const cpmmPoolId = await this.deriveCpmmPoolId(tokenMint);
                if (cpmmPoolId) poolIds.push(cpmmPoolId);
            } catch (e) { /* ignore */ }
            
            // Method 3: Standard AMM derivation
            try {
                const seeds = [
                    Buffer.from('pool'),
                    this.RAYDIUM_AMM_PROGRAM.toBuffer(),
                    tokenMint.toBuffer(),
                    this.SOL_MINT.toBuffer()
                ];
                const [poolId] = await PublicKey.findProgramAddress(seeds, this.RAYDIUM_AMM_PROGRAM);
                poolIds.push(poolId.toBase58());
            } catch (e) { /* ignore */ }
    
            logger.debug(`Testing ${poolIds.length} potential pool IDs for ${address}: ${poolIds.join(', ')}`);
    
            // Test each pool ID with the Raydium API
            for (const poolId of poolIds) {
                try {
                    logger.debug(`Testing pool ID ${poolId} with Raydium API`);
                    const trades = await this.getBonkfunPoolTrades(poolId, 1);
                    
                    if (trades && trades.length >= 0) {
                        logger.debug(`Successfully verified ${address} as bonk.fun token using pool ${poolId} (${trades.length} trades found)`);
                        // Store the working pool ID for later use
                        this._cachedPoolId = poolId;
                        return true;
                    }
                } catch (apiError) {
                    logger.debug(`Pool ID ${poolId} failed API test: ${apiError.message}`);
                }
            }
            
            logger.debug(`No working pool found for ${address}, not confirmed as bonk.fun`);
            return false;
        } catch (error) {
            logger.debug(`Token ${address} not found as bonk.fun token: ${error.message}`);
            return false;
        }
    }
    
    

    async deriveBonkfunPoolId(tokenMint) {
        try {
            logger.debug(`Starting pool derivation for bonk.fun token: ${tokenMint.toBase58()}`);
            
            // Method 1: Try LaunchLab pool derivation first (bonk.fun specific)
            try {
                const launchpadPoolId = await this.deriveLaunchpadPoolId(tokenMint);
                if (launchpadPoolId) {
                    logger.debug(`Derived LaunchLab pool ID: ${launchpadPoolId}`);
                    return launchpadPoolId;
                }
            } catch (launchpadError) {
                logger.debug(`LaunchLab derivation failed: ${launchpadError.message}`);
            }
    
            // Method 2: Try with Raydium SDK (if available)
            try {
                const { getPdaPoolId } = require('@raydium-io/raydium-sdk');
                const { publicKey: poolId } = await getPdaPoolId(
                    this.RAYDIUM_AMM_PROGRAM,
                    this.RAYDIUM_CONFIG,
                    tokenMint,
                    this.SOL_MINT
                );
                logger.debug(`Derived standard AMM pool ID: ${poolId.toBase58()}`);
                return poolId.toBase58();
            } catch (sdkError) {
                logger.debug('Raydium SDK not available or failed, trying other methods');
            }
    
            // Method 3: Try CPMM derivation
            try {
                const cpmmPoolId = await this.deriveCpmmPoolId(tokenMint);
                if (cpmmPoolId) {
                    logger.debug(`Derived CPMM pool ID: ${cpmmPoolId}`);
                    return cpmmPoolId;
                }
            } catch (cpmmError) {
                logger.debug(`CPMM derivation failed: ${cpmmError.message}`);
            }
    
            // Method 4: Manual PDA derivation for legacy AMM
            try {
                const seeds = [
                    Buffer.from('pool'),
                    this.RAYDIUM_AMM_PROGRAM.toBuffer(),
                    tokenMint.toBuffer(),
                    this.SOL_MINT.toBuffer()
                ];
                
                const [poolId] = await PublicKey.findProgramAddress(
                    seeds,
                    this.RAYDIUM_AMM_PROGRAM
                );
                
                logger.debug(`Derived manual AMM pool ID: ${poolId.toBase58()}`);
                return poolId.toBase58();
            } catch (manualError) {
                logger.debug(`Manual derivation failed: ${manualError.message}`);
            }
    
            logger.error('All pool derivation methods failed');
            return null;
        } catch (error) {
            logger.error('Error in pool derivation:', error);
            return null;
        }
    }

    async deriveLaunchpadPoolId(tokenMint) {
        try {
            // Try with Raydium SDK first (most accurate)
            try {
                const { getPdaLaunchpadPoolId } = require('@raydium-io/raydium-sdk-v2');
                const poolPda = await getPdaLaunchpadPoolId(
                    this.LAUNCHLAB_PROGRAM,
                    tokenMint
                );
                return poolPda.publicKey.toBase58();
            } catch (sdkError) {
                logger.debug('Raydium SDK v2 not available, using manual LaunchLab derivation');
            }
    
            // Manual LaunchLab pool derivation
            const seeds = [
                Buffer.from('pool'),
                tokenMint.toBuffer()
            ];
            
            const [poolId] = await PublicKey.findProgramAddress(
                seeds,
                this.LAUNCHLAB_PROGRAM
            );
            
            return poolId.toBase58();
        } catch (error) {
            logger.debug(`LaunchLab pool derivation failed: ${error.message}`);
            throw error;
        }
    }
    
    // NEW: CPMM pool derivation (alternative method)
    async deriveCpmmPoolId(tokenMint) {
        try {
            // CPMM uses different seed structure
            const seeds = [
                Buffer.from('cp_pool'),
                tokenMint.toBuffer(),
                this.SOL_MINT.toBuffer()
            ];
            
            const [poolId] = await PublicKey.findProgramAddress(
                seeds,
                this.RAYDIUM_CPMM_PROGRAM
            );
            
            return poolId.toBase58();
        } catch (error) {
            logger.debug(`CPMM pool derivation failed: ${error.message}`);
            throw error;
        }
    }

    async getBonkfunAllTrades(tokenAddress, limit = 200, offset = 0) {
        try {
            const tokenMint = new PublicKey(tokenAddress);
            
            let poolId = this._cachedPoolId; // Use cached pool ID if available
            
            if (!poolId) {
                // Derive the pool ID if not cached
                poolId = await this.deriveBonkfunPoolId(tokenMint);
                if (!poolId) {
                    throw new Error('Could not derive pool ID for bonk.fun token');
                }
            }
    
            logger.debug(`Using pool ID ${poolId} for bonk.fun token ${tokenAddress}`);
    
            // Fetch trades from Raydium API
            const trades = await this.getBonkfunPoolTrades(poolId, limit);
            
            if (!trades || trades.length === 0) {
                return [];
            }
    
            // Transform Raydium trade data to match PumpFun format
            return trades.map(trade => {
                const isBuy = trade.side === 'buy';
                
                return {
                    is_buy: isBuy,
                    user: trade.owner,
                    slot: this.estimateSlotFromTimestamp(trade.blockTime),
                    signature: trade.txid,
                    token_amount: isBuy ? (trade.amountA * Math.pow(10, 6)) : (trade.amountB * Math.pow(10, 6)),
                    sol_amount: isBuy ? (trade.amountB * Math.pow(10, 9)) : (trade.amountA * Math.pow(10, 9)),
                    timestamp: trade.blockTime,
                    block_time: trade.blockTime
                };
            });
    
        } catch (error) {
            logger.error(`Error fetching bonk.fun trades for ${tokenAddress}:`, error);
            throw error;
        }
    }
    
    // IMPROVED: Better error handling for pool trades
    async getBonkfunPoolTrades(poolId, limit = 200) {
        try {
            const url = `${this.RAYDIUM_API_BASE}/trade?poolId=${poolId}&limit=${limit}`;
            
            logger.debug(`Fetching trades from Raydium API: ${url}`);
            
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (data.success && data.data && data.data.rows) {
                logger.debug(`Successfully fetched ${data.data.rows.length} trades from pool ${poolId}`);
                return data.data.rows;
            }
            
            if (data.error) {
                throw new Error(`API Error: ${data.error}`);
            }
            
            logger.debug(`No trades found for pool ${poolId}`);
            return [];
        } catch (error) {
            logger.error(`Error fetching bonk.fun pool trades for ${poolId}: ${error.message}`);
            throw error;
        }
    }

    estimateSlotFromTimestamp(timestamp) {
        // Convert timestamp to approximate slot number
        const SOLANA_GENESIS_TIMESTAMP = 1609459200; // Approximate
        const SLOTS_PER_SECOND = 2.2;
        
        return Math.floor((timestamp - SOLANA_GENESIS_TIMESTAMP) * SLOTS_PER_SECOND);
    }

    async analyzeBundle(address, limit = 50000, isTeamAnalysis = false) {
        logger.debug(`Starting bundle analysis for ${address}`);
        
        // Use improved platform detection
        const platform = await this.detectTokenPlatform(address);
        
        if (platform === 'pumpfun') {
            logger.debug('Detected PumpFun token, using PumpFun analyzer');
            const result = await this.analyzePumpfunBundle(address, limit, isTeamAnalysis);
            result.platform = 'PumpFun';
            return result;
        }
        
        if (platform === 'bonkfun') {
            logger.debug('Detected Bonk.fun token, using Bonk.fun analyzer');
            const result = await this.analyzeBonkfunBundle(address, limit, isTeamAnalysis);
            result.platform = 'Bonk.fun';
            return result;
        }
        
        // If neither platform is detected
        throw new Error(`This token is not supported. Bundle analysis only works with PumpFun (.../pump) and Bonk.fun (.../bonk) tokens. Token ${address} was not detected as either platform.`);
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
            const result = await this.performTeamAnalysis(filteredBundles, tokenInfo, totalSupply);
            result.platform = 'PumpFun';
            return result;
        } else {
            const result = await this.performRegularAnalysis(filteredBundles, tokenInfo, totalSupply);
            result.platform = 'PumpFun';
            return result;
        }
    }

    // NEW: Bonk.fun bundle analysis method
    async analyzeBonkfunBundle(address, limit, isTeamAnalysis) {
        let offset = 0;
        const pageLimit = 200;
        let hasMoreTransactions = true;
        const allTrades = [];

        // Fetch all trades from Bonk.fun (via Raydium API)
        while (hasMoreTransactions) {
            logger.debug(`Fetching trades from Bonk.fun/Raydium API. Offset: ${offset}, Limit: ${pageLimit}`);
            const trades = await this.getBonkfunAllTrades(address, pageLimit, offset);

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
                logger.debug('No more trades found from Bonk.fun/Raydium API');
            }
        }

        logger.debug(`Total trades fetched: ${allTrades.length}`);

        // Group trades by time window (since Raydium API doesn't give exact slots)
        const timeWindowBundles = this.groupTradesByTimeWindow(allTrades.filter(t => t.is_buy));

        const filteredBundles = Object.entries(timeWindowBundles)
            .filter(([_, bundle]) => bundle.uniqueWallets.size >= 2)
            .map(([timeWindow, bundle]) => ({
                slot: parseInt(timeWindow), // Using time window as slot approximation
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
            const result = await this.performTeamAnalysis(filteredBundles, tokenInfo, totalSupply);
            result.platform = 'Bonk.fun';
            return result;
        } else {
            const result = await this.performRegularAnalysis(filteredBundles, tokenInfo, totalSupply);
            result.platform = 'Bonk.fun';
            return result;
        }
    }

    groupTradesByTimeWindow(buyTrades, windowSeconds = 10) {
        const timeWindows = {};

        buyTrades.forEach(trade => {
            // Group trades within 10-second windows
            const timeWindow = Math.floor(trade.timestamp / windowSeconds);
            
            if (!timeWindows[timeWindow]) {
                timeWindows[timeWindow] = {
                    uniqueWallets: new Set(),
                    tokensBought: 0,
                    solSpent: 0,
                    transactions: []
                };
            }

            timeWindows[timeWindow].uniqueWallets.add(trade.user);
            timeWindows[timeWindow].tokensBought += trade.token_amount / this.TOKEN_FACTOR;
            timeWindows[timeWindow].solSpent += trade.sol_amount / this.SOL_FACTOR;
            timeWindows[timeWindow].transactions.push(trade);
        });

        return timeWindows;
    }

    // Keep all your existing methods below (performTeamAnalysis, performRegularAnalysis, etc.)
    async performTeamAnalysis(filteredBundles, tokenInfo, totalSupply) {
        const teamWallets = new Set();
        const allWallets = new Set(filteredBundles.flatMap(bundle => Array.from(bundle.uniqueWallets)));

        logger.debug(`\n=== TEAM ANALYSIS DEBUG ===`);
        logger.debug(`Total unique wallets in bundles: ${allWallets.size}`);

        // Step 1: Find wallets that appear in 2+ bundles
        const walletBundleCount = {};
        filteredBundles.forEach(bundle => {
            Array.from(bundle.uniqueWallets).forEach(wallet => {
                walletBundleCount[wallet] = (walletBundleCount[wallet] || 0) + 1;
            });
        });

        Object.entries(walletBundleCount).forEach(([wallet, count]) => {
            if (count >= 2) {
                teamWallets.add(wallet);
            }
        });

        logger.debug(`Wallets appearing in 2+ bundles: ${teamWallets.size}`);

        // Filter bundles to only include team wallets
        const teamBundles = filteredBundles.map(bundle => {
            const teamWalletsInBundle = new Set(
                Array.from(bundle.uniqueWallets).filter(wallet => teamWallets.has(wallet))
            );

            if (teamWalletsInBundle.size >= 2) {
                return {
                    ...bundle,
                    uniqueWallets: teamWalletsInBundle,
                    uniqueWalletsCount: teamWalletsInBundle.size
                };
            }
            return null;
        }).filter(bundle => bundle !== null);

        logger.debug(`Team bundles found: ${teamBundles.length}`);

        // Calculate team totals
        let totalTeamTokens = 0;
        let totalTeamSol = 0;

        teamBundles.forEach(bundle => {
            totalTeamTokens += bundle.tokensBought;
            totalTeamSol += bundle.solSpent;
        });

        const percentageBundled = totalSupply > 0 ? (totalTeamTokens / totalSupply) * 100 : 0;

        // Get current holdings for team wallets
        const teamWalletsArray = Array.from(teamWallets);
        logger.debug(`Analyzing holdings for ${teamWalletsArray.length} team wallets`);

        let totalHoldingAmount = 0;
        const solanaApi = getSolanaApi();

        // Process wallets in batches
        const batchSize = 10;
        for (let i = 0; i < teamWalletsArray.length; i += batchSize) {
            const batch = teamWalletsArray.slice(i, i + batchSize);
            
            try {
                const holdingPromises = batch.map(async (wallet) => {
                    try {
                        const balance = await solanaApi.getTokenAccountBalance(
                            wallet, 
                            tokenInfo.address, 
                            'bundle', 
                            'teamAnalysis'
                        );
                        return balance || 0;
                    } catch (error) {
                        logger.debug(`Failed to get balance for wallet ${wallet}: ${error.message}`);
                        return 0;
                    }
                });

                const holdings = await Promise.all(holdingPromises);
                const batchTotal = holdings.reduce((sum, holding) => sum + holding, 0);
                totalHoldingAmount += batchTotal;

                logger.debug(`Batch ${Math.floor(i/batchSize) + 1}: ${holdings.length} wallets, ${batchTotal} tokens`);
            } catch (error) {
                logger.error(`Error processing wallet batch: ${error.message}`);
            }
        }

        const totalHoldingAmountPercentage = totalSupply > 0 ? (totalHoldingAmount / totalSupply) * 100 : 0;

        logger.debug(`\n=== TEAM ANALYSIS RESULTS ===`);
        logger.debug(`Total team holding amount: ${totalHoldingAmount}`);
        logger.debug(`Total team holding percentage: ${totalHoldingAmountPercentage}%`);

        return {
            totalBundles: teamBundles.length,
            totalTokensBundled: totalTeamTokens,
            percentageBundled: percentageBundled,
            totalSolSpent: totalTeamSol,
            totalHoldingAmount: totalHoldingAmount,
            totalHoldingAmountPercentage: totalHoldingAmountPercentage,
            allBundles: teamBundles,
            teamBundles: teamBundles,
            tokenInfo: tokenInfo,
            isTeamAnalysis: true,
            totalTeamWallets: teamWallets.size
        };
    }

    // Add this method to improve platform detection in your bundle.js constructor:
    async detectTokenPlatform(address) {
        // First check by address pattern (more reliable for initial detection)
        if (address.toLowerCase().endsWith('pump')) {
            logger.debug(`Token ${address} detected as PumpFun based on address pattern`);
            // Verify with API
            const isPumpfun = await this.isPumpfunCoin(address);
            if (isPumpfun) {
                return 'pumpfun';
            }
        }
        
        if (address.toLowerCase().endsWith('bonk')) {
            logger.debug(`Token ${address} detected as Bonk.fun based on address pattern`);
            // Verify with API
            const isBonkfun = await this.isBonkfunCoin(address);
            if (isBonkfun) {
                return 'bonkfun';
            }
        }
        
        // Fallback to API-based detection if address pattern doesn't match
        logger.debug(`Checking ${address} with API-based detection`);
        
        const isPumpfun = await this.isPumpfunCoin(address);
        if (isPumpfun) {
            return 'pumpfun';
        }
        
        const isBonkfun = await this.isBonkfunCoin(address);
        if (isBonkfun) {
            return 'bonkfun';
        }
        
        return null;
    }

    async performRegularAnalysis(filteredBundles, tokenInfo, totalSupply) {
        let totalTokensBundled = 0;
        let totalSolSpent = 0;

        filteredBundles.forEach(bundle => {
            totalTokensBundled += bundle.tokensBought;
            totalSolSpent += bundle.solSpent;
        });

        const percentageBundled = totalSupply > 0 ? (totalTokensBundled / totalSupply) * 100 : 0;

        // Get current holdings for all bundle participants
        const allWallets = new Set();
        filteredBundles.forEach(bundle => {
            Array.from(bundle.uniqueWallets).forEach(wallet => allWallets.add(wallet));
        });

        const walletsArray = Array.from(allWallets);
        logger.debug(`Analyzing holdings for ${walletsArray.length} unique wallets`);

        let totalHoldingAmount = 0;
        const solanaApi = getSolanaApi();

        // Process wallets in batches
        const batchSize = 10;
        for (let i = 0; i < walletsArray.length; i += batchSize) {
            const batch = walletsArray.slice(i, i + batchSize);
            
            try {
                const holdingPromises = batch.map(async (wallet) => {
                    try {
                        const balance = await solanaApi.getTokenAccountBalance(
                            wallet, 
                            tokenInfo.address, 
                            'bundle', 
                            'regularAnalysis'
                        );
                        return balance || 0;
                    } catch (error) {
                        logger.debug(`Failed to get balance for wallet ${wallet}: ${error.message}`);
                        return 0;
                    }
                });

                const holdings = await Promise.all(holdingPromises);
                const batchTotal = holdings.reduce((sum, holding) => sum + holding, 0);
                totalHoldingAmount += batchTotal;

                logger.debug(`Batch ${Math.floor(i/batchSize) + 1}: ${holdings.length} wallets, ${batchTotal} tokens`);
            } catch (error) {
                logger.error(`Error processing wallet batch: ${error.message}`);
            }
        }

        // Add holding amounts to individual bundles
        const bundlesWithHoldings = await Promise.all(
            filteredBundles.slice(0, 20).map(async (bundle) => {
                let bundleHoldingAmount = 0;
                const bundleWalletsArray = Array.from(bundle.uniqueWallets);

                for (const wallet of bundleWalletsArray) {
                    try {
                        const balance = await solanaApi.getTokenAccountBalance(
                            wallet, 
                            tokenInfo.address, 
                            'bundle', 
                            'bundleHoldings'
                        );
                        bundleHoldingAmount += balance || 0;
                    } catch (error) {
                        logger.debug(`Failed to get balance for bundle wallet ${wallet}: ${error.message}`);
                    }
                }

                const bundleHoldingPercentage = totalSupply > 0 ? (bundleHoldingAmount / totalSupply) * 100 : 0;

                return {
                    ...bundle,
                    holdingAmount: bundleHoldingAmount,
                    holdingPercentage: bundleHoldingPercentage
                };
            })
        );

        const totalHoldingAmountPercentage = totalSupply > 0 ? (totalHoldingAmount / totalSupply) * 100 : 0;

        logger.debug(`\n=== REGULAR ANALYSIS RESULTS ===`);
        logger.debug(`Total holding amount: ${totalHoldingAmount}`);
        logger.debug(`Total holding percentage: ${totalHoldingAmountPercentage}%`);

        return {
            totalBundles: filteredBundles.length,
            totalTokensBundled: totalTokensBundled,
            percentageBundled: percentageBundled,
            totalSolSpent: totalSolSpent,
            totalHoldingAmount: totalHoldingAmount,
            totalHoldingAmountPercentage: totalHoldingAmountPercentage,
            allBundles: bundlesWithHoldings,
            teamBundles: [],
            tokenInfo: tokenInfo,
            isTeamAnalysis: false
        };
    }
}

module.exports = new PumpfunBundleAnalyzer();