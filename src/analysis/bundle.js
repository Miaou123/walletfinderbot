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
        
        // Bonk.fun specific constants
        this.RAYDIUM_API_BASE = 'https://launch-history-v1.raydium.io';
        this.RAYDIUM_V3_API = 'https://api-v3.raydium.io';
        
        // FIXED: Added missing program constants
        this.LAUNCHLAB_PROGRAM = new PublicKey('LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj');
        this.RAYDIUM_CPMM_PROGRAM = new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C');
        this.RAYDIUM_AMM_PROGRAM = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
        this.SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
        
        // Known pool mappings for immediate fixes
        this.KNOWN_BONKFUN_POOLS = {
            'CssndHPw8AdKRRpcNowaA8QFcihaf139pRa98oxobonk': '93nDGcvueZzf8N5mP6hJuSUcHja7UAU1zwVd85vCn71R',
            'HhfyQNANe8DNAgSaMNRAW5GAs6J15PpTNMUpzBbbonk': '4sRW7YEmDXbBZRVGAUBT4RHPWcJ8ALyXmfYbd9dtWNtg'
        };
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
                name: tokenAsset.symbol || 'Unknown',
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

    // FIXED: Enhanced Bonk.fun detection with proper pool discovery
    async isBonkfunCoin(address) {
        try {
            // If it ends with 'bonk', be more permissive
            const endsWithBonk = address.toLowerCase().endsWith('bonk');
            
            if (!endsWithBonk) {
                logger.debug(`Token ${address} doesn't end with 'bonk', likely not bonk.fun`);
                return false;
            }

            // Check known pools first
            if (this.KNOWN_BONKFUN_POOLS[address]) {
                const poolId = this.KNOWN_BONKFUN_POOLS[address];
                if (await this.testBonkfunPoolId(poolId)) {
                    logger.debug(`Successfully verified ${address} as bonk.fun token using known pool ${poolId}`);
                    this._cachedPoolId = poolId;
                    return true;
                }
            }

            // Try API discovery
            const apiPool = await this.findPoolViaAPI(address);
            if (apiPool && await this.testBonkfunPoolId(apiPool)) {
                logger.debug(`Successfully verified ${address} as bonk.fun token using API pool ${apiPool}`);
                this._cachedPoolId = apiPool;
                return true;
            }

            // Try comprehensive pool discovery
            try {
                const poolId = await this.getBonkfunPoolId(address);
                if (poolId) {
                    logger.debug(`Successfully verified ${address} as bonk.fun token using discovered pool ${poolId}`);
                    this._cachedPoolId = poolId;
                    return true;
                }
            } catch (error) {
                logger.debug(`Pool discovery failed for ${address}: ${error.message}`);
            }

            // If it ends with 'bonk' but we can't find a pool, still treat it as bonk.fun
            logger.debug(`Token ${address} ends with 'bonk' but no pool found yet - will treat as bonk.fun`);
            return true;

        } catch (error) {
            logger.debug(`Token ${address} bonk.fun detection error: ${error.message}`);
            
            // If it ends with 'bonk', still return true even if detection fails
            if (address.toLowerCase().endsWith('bonk')) {
                logger.debug(`${address} ends with 'bonk' - treating as bonk.fun despite detection error`);
                return true;
            }
            
            return false;
        }
    }

    // Get known bonk.fun pool ID
    getKnownBonkfunPoolId(tokenAddress) {
        if (this.KNOWN_BONKFUN_POOLS[tokenAddress]) {
            logger.debug(`Using known pool mapping: ${tokenAddress} -> ${this.KNOWN_BONKFUN_POOLS[tokenAddress]}`);
            return this.KNOWN_BONKFUN_POOLS[tokenAddress];
        }
        return null;
    }

    // API-based pool discovery
    async findPoolViaAPI(tokenAddress) {
        try {
            logger.debug(`Searching for pool via Raydium V3 API...`);
            
            const url = `${this.RAYDIUM_V3_API}/pools/info/mint?mint1=${tokenAddress}&poolType=cpmm&poolSortField=liquidity&sortType=desc&pageSize=10&page=1`;
            
            const response = await fetch(url);
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.data && data.data.data && data.data.data.length > 0) {
                    const pool = data.data.data[0];
                    logger.debug(`Found pool via API: ${pool.id}`);
                    return pool.id;
                }
            }
        } catch (error) {
            logger.debug(`API pool discovery failed: ${error.message}`);
        }
        return null;
    }

    // Test if pool ID works
    async testBonkfunPoolId(poolId) {
        try {
            const result = await this.getBonkfunPoolTrades(poolId, 1);
            if (result && result.trades) {
                return Array.isArray(result.trades);
            }
            return Array.isArray(result);
        } catch (error) {
            return false;
        }
    }

    // ENHANCED: Comprehensive pool discovery for bonk.fun tokens
    async getBonkfunPoolId(tokenAddress) {
        try {
            // Step 1: Check known mappings first (immediate fix)
            const knownPool = this.getKnownBonkfunPoolId(tokenAddress);
            if (knownPool) {
                if (await this.testBonkfunPoolId(knownPool)) {
                    logger.debug(`Using known pool mapping: ${knownPool}`);
                    return knownPool;
                }
            }
            
            // Step 2: Try API discovery (bonk.fun website data)
            const apiPool = await this.findPoolViaAPI(tokenAddress);
            if (apiPool) {
                if (await this.testBonkfunPoolId(apiPool)) {
                    logger.debug(`Found pool via API: ${apiPool}`);
                    return apiPool;
                }
            }
            
            // Step 3: Multi-pool derivation and testing
            const candidatePools = await this.deriveAllBonkfunPools(tokenAddress);
            
            logger.debug(`Found ${candidatePools.length} candidate pools for ${tokenAddress}`);
            
            // Test all pools and find the one with trades
            for (const pool of candidatePools) {
                const testResult = await this.testBonkfunPoolWithTrades(pool.poolId);
                
                logger.debug(`Testing ${pool.name}: ${pool.poolId} - ${testResult.tradeCount} trades`);
                
                if (testResult.valid && testResult.tradeCount > 0) {
                    logger.debug(`✅ Found active pool: ${pool.poolId} (${pool.name}) with ${testResult.tradeCount} trades`);
                    return pool.poolId;
                }
            }
            
            // If no pool has trades, return the first valid one (bonding curve)
            for (const pool of candidatePools) {
                const testResult = await this.testBonkfunPoolWithTrades(pool.poolId);
                if (testResult.valid) {
                    logger.debug(`⚠️ Using valid pool without trades: ${pool.poolId} (${pool.name})`);
                    return pool.poolId;
                }
            }
            
            throw new Error(`No valid pools found for bonk.fun token ${tokenAddress}`);
            
        } catch (error) {
            logger.error(`Error finding bonk.fun pool for ${tokenAddress}: ${error.message}`);
            throw error;
        }
    }

    // Derive all possible bonk.fun pools
    async deriveAllBonkfunPools(tokenAddress) {
        const tokenMint = new PublicKey(tokenAddress);
        const pools = [];
        
        const derivationMethods = [
            // LaunchLab patterns (bonding curve)
            {
                name: 'LaunchLab Standard',
                program: this.LAUNCHLAB_PROGRAM,
                seeds: () => [Buffer.from('pool'), tokenMint.toBuffer()]
            },
            {
                name: 'LaunchLab with SOL',
                program: this.LAUNCHLAB_PROGRAM,
                seeds: () => [Buffer.from('pool'), tokenMint.toBuffer(), this.SOL_MINT.toBuffer()]
            },
            
            // CPMM patterns (migrated pools)
            {
                name: 'CPMM Standard',
                program: this.RAYDIUM_CPMM_PROGRAM,
                seeds: () => [Buffer.from('cp_pool'), tokenMint.toBuffer(), this.SOL_MINT.toBuffer()]
            },
            {
                name: 'CPMM Reverse',
                program: this.RAYDIUM_CPMM_PROGRAM,
                seeds: () => [Buffer.from('cp_pool'), this.SOL_MINT.toBuffer(), tokenMint.toBuffer()]
            },
            {
                name: 'CPMM Alternative',
                program: this.RAYDIUM_CPMM_PROGRAM,
                seeds: () => [Buffer.from('pool'), tokenMint.toBuffer(), this.SOL_MINT.toBuffer()]
            },
            
            // AMM patterns (legacy)
            {
                name: 'AMM Legacy',
                program: this.RAYDIUM_AMM_PROGRAM,
                seeds: () => [Buffer.from('pool'), this.RAYDIUM_AMM_PROGRAM.toBuffer(), tokenMint.toBuffer(), this.SOL_MINT.toBuffer()]
            },
            {
                name: 'AMM Simple',
                program: this.RAYDIUM_AMM_PROGRAM,
                seeds: () => [Buffer.from('pool'), tokenMint.toBuffer(), this.SOL_MINT.toBuffer()]
            }
        ];
        
        for (const method of derivationMethods) {
            try {
                const seeds = method.seeds();
                const [poolId] = await PublicKey.findProgramAddress(seeds, method.program);
                
                pools.push({
                    name: method.name,
                    poolId: poolId.toBase58(),
                    program: method.program.toBase58()
                });
            } catch (error) {
                logger.debug(`${method.name} derivation failed: ${error.message}`);
            }
        }
        
        return pools;
    }

    // Enhanced: Test pool and get trade count
    async testBonkfunPoolWithTrades(poolId) {
        try {
            const result = await this.getBonkfunPoolTrades(poolId, 1);
            
            if (result && result.trades) {
                return {
                    valid: true,
                    tradeCount: result.trades.length,
                    hasData: result.trades.length > 0
                };
            }
            
            // Fallback for old format
            if (Array.isArray(result)) {
                return {
                    valid: true,
                    tradeCount: result.length,
                    hasData: result.length > 0
                };
            }
            
            return {
                valid: false,
                tradeCount: 0,
                hasData: false
            };
        } catch (error) {
            return {
                valid: false,
                tradeCount: 0,
                hasData: false,
                error: error.message
            };
        }
    }

    // FIXED: Proper Raydium API pagination using nextPageKey
    async getBonkfunPoolTrades(poolId, limit = 100, nextPageKey = null) {
        try {
            const effectiveLimit = Math.min(limit, 100);
            
            // Build URL with nextPageKey if provided
            let url = `${this.RAYDIUM_API_BASE}/trade?poolId=${poolId}&limit=${effectiveLimit}`;
            if (nextPageKey) {
                url += `&nextPageKey=${nextPageKey}`;
            }
            
            logger.debug(`Fetching trades from Raydium API: ${url}`);
            
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                logger.error(`API Error Details: Status ${response.status}, Response: ${errorText}`);
                
                if (response.status === 400) {
                    logger.warn(`Pool ${poolId} returned 400 - possibly no trades or invalid pool format`);
                    return { trades: [], nextPageKey: null };
                }
                
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            // Handle different possible response formats
            if (data && data.success === true && data.data) {
                const trades = data.data.rows || [];
                const nextKey = data.data.nextPageKey || null;
                
                logger.debug(`Successfully fetched ${trades.length} trades from pool ${poolId}`);
                if (nextKey) {
                    logger.debug(`Next page key available: ${nextKey.substring(0, 10)}...`);
                } else {
                    logger.debug(`No more pages available`);
                }
                
                return { trades, nextPageKey: nextKey };
            }
            
            // Handle direct array response (fallback)
            if (Array.isArray(data)) {
                logger.debug(`Successfully fetched ${data.length} trades from pool ${poolId} (direct array)`);
                return { trades: data, nextPageKey: null };
            }
            
            // Handle simple data object (fallback)
            if (data && Array.isArray(data.data)) {
                logger.debug(`Successfully fetched ${data.data.length} trades from pool ${poolId} (data array)`);
                return { trades: data.data, nextPageKey: null };
            }
            
            // Handle error response
            if (data && data.error) {
                logger.warn(`API returned error for pool ${poolId}: ${data.error}`);
                return { trades: [], nextPageKey: null };
            }
            
            logger.debug(`No trades found for pool ${poolId}`);
            return { trades: [], nextPageKey: null };
            
        } catch (error) {
            if (error.name === 'TypeError' && error.message.includes('fetch')) {
                logger.error(`Network error fetching trades for pool ${poolId}: ${error.message}`);
                throw new Error('Network error - please check your internet connection');
            }
            
            logger.error(`Error fetching bonk.fun pool trades for ${poolId}: ${error.message}`);
            
            if (error.message.includes('400') || error.message.includes('Bad Request')) {
                logger.warn(`Returning empty trades due to 400 error for pool ${poolId}`);
                return { trades: [], nextPageKey: null };
            }
            
            throw error;
        }
    }

    // UPDATED: getBonkfunAllTrades with proper pagination
    async getBonkfunAllTrades(tokenAddress, limit = 200, offset = 0) {
        try {
            let poolId = this._cachedPoolId;
            
            if (!poolId) {
                poolId = await this.getBonkfunPoolId(tokenAddress);
                this._cachedPoolId = poolId;
            }

            logger.debug(`Using pool ID ${poolId} for bonk.fun token ${tokenAddress}`);

            const allTrades = [];
            let nextPageKey = null;
            const pageSize = 100; // Raydium API max per request

            do {
                const result = await this.getBonkfunPoolTrades(poolId, pageSize, nextPageKey);
                
                if (result.trades && result.trades.length > 0) {
                    allTrades.push(...result.trades);
                    logger.debug(`Total trades fetched so far: ${allTrades.length}`);
                    
                    // Check if we've reached the requested limit
                    if (allTrades.length >= limit) {
                        logger.debug(`Reached specified limit of ${limit} trades. Stopping pagination.`);
                        break;
                    }
                    
                    // Update nextPageKey for next iteration
                    nextPageKey = result.nextPageKey;
                    
                    if (!nextPageKey) {
                        logger.debug(`No more pages available. Stopping pagination.`);
                        break;
                    }
                } else {
                    logger.debug(`No trades in this page. Stopping pagination.`);
                    break;
                }
            } while (nextPageKey && allTrades.length < limit);

            logger.debug(`Found ${allTrades.length} total trades for bonk.fun token ${tokenAddress}`);

            // Transform Raydium trade data to match PumpFun format
            return allTrades.slice(0, limit).map(trade => {
                const isBuy = trade.side === 'buy' || trade.type === 'buy';
                
                return {
                    is_buy: isBuy,
                    user: trade.owner || trade.user,
                    slot: this.estimateSlotFromTimestamp(trade.blockTime || trade.block_time),
                    signature: trade.txid || trade.signature,
                    token_amount: isBuy ? 
                        (trade.amountA * Math.pow(10, 6)) : 
                        (trade.amountB * Math.pow(10, 6)),
                    sol_amount: isBuy ? 
                        (trade.amountB * Math.pow(10, 9)) : 
                        (trade.amountA * Math.pow(10, 9)),
                    timestamp: trade.blockTime || trade.block_time,
                    block_time: trade.blockTime || trade.block_time
                };
            });

        } catch (error) {
            logger.error(`Error fetching bonk.fun trades for ${tokenAddress}:`, error);
            throw error;
        }
    }

    estimateSlotFromTimestamp(timestamp) {
        const SOLANA_GENESIS_TIMESTAMP = 1609459200;
        const SLOTS_PER_SECOND = 2.2;
        return Math.floor((timestamp - SOLANA_GENESIS_TIMESTAMP) * SLOTS_PER_SECOND);
    }

    // FIXED: Platform detection with proper prioritization
    async detectTokenPlatform(address) {
        // PRIORITY 1: Address pattern check (most reliable for initial detection)
        if (address.toLowerCase().endsWith('bonk')) {
            logger.debug(`Token ${address} detected as Bonk.fun based on address pattern`);
            
            // Try bonk.fun detection first
            const isBonkfun = await this.isBonkfunCoin(address);
            if (isBonkfun) {
                logger.debug(`Confirmed ${address} as Bonk.fun token`);
                return 'bonkfun';
            }
            
            // IMPORTANT: If it ends with 'bonk' but bonk.fun detection fails,
            // still return 'bonkfun' instead of falling back to PumpFun
            logger.debug(`${address} ends with 'bonk' but pool detection failed - treating as Bonk.fun anyway`);
            return 'bonkfun';
        }
        
        if (address.toLowerCase().endsWith('pump')) {
            logger.debug(`Token ${address} detected as PumpFun based on address pattern`);
            
            // Verify with API
            const isPumpfun = await this.isPumpfunCoin(address);
            if (isPumpfun) {
                logger.debug(`Confirmed ${address} as PumpFun token`);
                return 'pumpfun';
            }
        }
        
        // PRIORITY 2: API-based detection for tokens without clear patterns
        logger.debug(`Checking ${address} with API-based detection`);
        
        // Try PumpFun first (more common)
        const isPumpfun = await this.isPumpfunCoin(address);
        if (isPumpfun) {
            logger.debug(`API confirmed ${address} as PumpFun token`);
            return 'pumpfun';
        }
        
        // Try Bonk.fun as fallback
        const isBonkfun = await this.isBonkfunCoin(address);
        if (isBonkfun) {
            logger.debug(`API confirmed ${address} as Bonk.fun token`);
            return 'bonkfun';
        }
        
        return null;
    }

    async analyzeBundle(address, limit = 50000, isTeamAnalysis = false) {
        logger.debug(`Starting bundle analysis for ${address}`);
        
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
        
        throw new Error(`This token is not supported. Bundle analysis only works with PumpFun (.../pump) and Bonk.fun (.../bonk) tokens. Token ${address} was not detected as either platform.`);
    }

    // UNCHANGED: Keep all existing PumpFun code exactly as is
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

    // FIXED: Simplified bonk.fun bundle analysis
    async analyzeBonkfunBundle(address, limit, isTeamAnalysis) {
        logger.debug(`Fetching trades from Bonk.fun/Raydium API for ${address}`);
        
        // Fetch all trades using proper pagination
        const allTrades = await this.getBonkfunAllTrades(address, limit);
        
        logger.debug(`Total trades fetched: ${allTrades.length}`);
    
        // Group trades by time window (since Raydium doesn't give exact slots)
        const timeWindowBundles = this.groupTradesByTimeWindow(allTrades.filter(t => t.is_buy));
    
        const filteredBundles = Object.entries(timeWindowBundles)
            .filter(([_, bundle]) => bundle.uniqueWallets.size >= 2)
            .map(([timeWindow, bundle]) => ({
                slot: parseInt(timeWindow),
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

    // UNCHANGED: Keep all existing analysis methods exactly as they are
    async performTeamAnalysis(filteredBundles, tokenInfo, totalSupply) {
        const teamWallets = new Set();
        const allWallets = new Set(filteredBundles.flatMap(bundle => Array.from(bundle.uniqueWallets)));

        logger.debug(`\n=== TEAM ANALYSIS DEBUG ===`);
        logger.debug(`Total unique wallets in bundles: ${allWallets.size}`);

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

        let totalTeamTokens = 0;
        let totalTeamSol = 0;

        teamBundles.forEach(bundle => {
            totalTeamTokens += bundle.tokensBought;
            totalTeamSol += bundle.solSpent;
        });

        const percentageBundled = totalSupply > 0 ? (totalTeamTokens / totalSupply) * 100 : 0;

        const teamWalletsArray = Array.from(teamWallets);
        logger.debug(`Analyzing holdings for ${teamWalletsArray.length} team wallets`);

        let totalHoldingAmount = 0;
        const solanaApi = getSolanaApi();

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

    async performRegularAnalysis(filteredBundles, tokenInfo, totalSupply) {
        let totalTokensBundled = 0;
        let totalSolSpent = 0;

        filteredBundles.forEach(bundle => {
            totalTokensBundled += bundle.tokensBought;
            totalSolSpent += bundle.solSpent;
        });

        const percentageBundled = totalSupply > 0 ? (totalTokensBundled / totalSupply) * 100 : 0;

        const allWallets = new Set();
        filteredBundles.forEach(bundle => {
            Array.from(bundle.uniqueWallets).forEach(wallet => allWallets.add(wallet));
        });

        const walletsArray = Array.from(allWallets);
        logger.debug(`Analyzing holdings for ${walletsArray.length} unique wallets`);

        let totalHoldingAmount = 0;
        const solanaApi = getSolanaApi();

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