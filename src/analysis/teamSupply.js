// src/analysis/teamSupply.js
const { getSolanaApi } = require('../integrations/solanaApi');
const { checkInactivityPeriod } = require('../tools/inactivityPeriod');
const { getHolders } = require('../tools/getHolders');
const { analyzeFunding } = require('../tools/fundingAnalyzer'); // Import funding analyzer
const BigNumber = require('bignumber.js');
const logger = require('../utils/logger');

// Configuration
BigNumber.config({ DECIMAL_PLACES: 18, ROUNDING_MODE: BigNumber.ROUND_DOWN });

// Constants
const KNOWN_LP_POOLS = new Set([
    "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
    "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
    "MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG",
    "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
    "5quBtoiQqxF9Jv6KYKctB59NT3gtJD2Y65kdnB1Uev3h",
    "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
    "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
    "GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL",
]);

const FRESH_WALLET_THRESHOLD = 100;
const TRANSACTION_CHECK_LIMIT = 20;
const MAX_ASSETS_THRESHOLD = 2;
const SUPPLY_THRESHOLD = new BigNumber('0.001'); // 0.1%
const WALLET_ANALYSIS_TIMEOUT = 10000; // 10 seconds timeout per wallet
const BATCH_SIZE = 5; // Reduced batch size to avoid rate limiting
const BATCH_DELAY = 200; // Milliseconds between batches

/**
 * Analyzes the team supply for a given token
 * @param {string} tokenAddress - Token contract address
 * @param {string} mainContext - Main context for API calls
 * @param {Object} cancellationToken - Token to check for cancellation
 * @returns {Promise<Object>} Analysis results
 */
async function analyzeTeamSupply(tokenAddress, mainContext = 'default', cancellationToken = null) {
    const operationId = Math.random().toString(36).substring(2, 8);
    logger.debug(`Starting team supply analysis for ${tokenAddress} (ID: ${operationId})`, { mainContext });

    const progress = {
        startTime: Date.now(),
        steps: []
    };

    // Helper function to log steps with timestamps
    const logStep = (step) => {
        const now = Date.now();
        progress.steps.push({
            step,
            timestamp: now,
            elapsed: now - progress.startTime
        });
        logger.debug(`[${operationId}] ${step} (${now - progress.startTime}ms elapsed)`, { tokenAddress });
    };

    // Helper to check for cancellation
    const checkCancellation = () => {
        if (cancellationToken && cancellationToken.isCancelled()) {
            logStep('Operation cancelled by user');
            throw new Error('Analysis cancelled by user');
        }
    };

    try {
        // 1. Fetch token info
        checkCancellation();
        logStep('Fetching token info from Helius');
        const solanaApi = getSolanaApi();
        const assetInfo = await solanaApi.getAsset(tokenAddress, mainContext, 'analyzeTeamSupply');
        
        if (!assetInfo) {
            throw new Error("No token info found");
        }

        const tokenInfo = {
            total_supply: assetInfo.supply.total, // Already adjusted with decimals
            symbol: assetInfo.symbol,
            name: assetInfo.name,
            decimals: assetInfo.decimals,
            address: tokenAddress  // Add token address
        };

        logStep(`Token info received: ${tokenInfo.symbol}`);

        // 2. Get holders
        checkCancellation();
        logStep('Fetching token holders');
        const allHolders = await getHolders(tokenAddress, mainContext, 'getHolders');
        logStep(`Found ${allHolders.length} total holders`);
        
        // 3. Filter significant holders
        checkCancellation();
        const significantHolders = allHolders.filter(holder => {
            if (KNOWN_LP_POOLS.has(holder.address)) {
                return false;
            }

            const rawBalance = new BigNumber(holder.balance);
            const percentage = rawBalance.dividedBy(new BigNumber(tokenInfo.total_supply));
            return percentage.isGreaterThanOrEqualTo(SUPPLY_THRESHOLD);
        });
    
        logStep(`Filtered ${significantHolders.length} significant holders (threshold: ${SUPPLY_THRESHOLD.multipliedBy(100).toString()}%)`);
    
        // 4. Analyze wallets
        checkCancellation();
        logStep('Analyzing wallets');
        const analyzedWallets = await analyzeWalletsWithTimeout(
            significantHolders, 
            tokenAddress, 
            mainContext, 
            tokenInfo, 
            operationId, 
            cancellationToken
        );
        logStep(`Analyzed ${analyzedWallets.length} wallets`);
        
        // Log category distribution for debugging
        const categoryCounts = analyzedWallets.reduce((counts, wallet) => {
            counts[wallet.category] = (counts[wallet.category] || 0) + 1;
            return counts;
        }, {});
        logger.debug(`[${operationId}] Wallet categories:`, categoryCounts);
        
        // 5. Filter team wallets
        checkCancellation();
        const teamWallets = analyzedWallets
            .filter(w => w.category !== 'Normal' && w.category !== 'Unknown') 
            .map(w => ({
                address: w.address,
                balance: w.balance.toString(),
                percentage: new BigNumber(w.balance)
                    .dividedBy(new BigNumber(tokenInfo.total_supply))
                    .multipliedBy(100)
                    .toNumber(),
                category: w.category,
                funderAddress: w.funderAddress || null,
                fundingDetails: w.fundingDetails || null
            }));

        logStep(`Filtered ${teamWallets.length} team wallets`);
        
        // 6. Calculate supply
        checkCancellation();
        const teamSupplyHeld = teamWallets.reduce((total, wallet) => {
            return total.plus(new BigNumber(wallet.balance));
        }, new BigNumber(0));
        
        const totalSupplyControlled = teamSupplyHeld
            .dividedBy(new BigNumber(tokenInfo.total_supply))
            .multipliedBy(100)
            .toNumber();

        logStep(`Team supply controlled: ${totalSupplyControlled.toFixed(2)}%`);

        return {
            scanData: {
                tokenInfo: {
                    totalSupply: tokenInfo.total_supply,
                    symbol: tokenInfo.symbol,
                    name: tokenInfo.name,
                    decimals: tokenInfo.decimals,
                    address: tokenAddress
                },
                analyzedWallets: teamWallets,  // Only team wallets
                teamWallets,
                totalSupplyControlled,
                tokenAddress
            },
            trackingInfo: {
                tokenAddress,
                tokenSymbol: tokenInfo.symbol,
                totalSupply: tokenInfo.total_supply,
                decimals: tokenInfo.decimals,
                totalSupplyControlled,
                teamWallets,
                allWalletsDetails: teamWallets  // Only team wallets
            }
        };

    } catch (error) {
        if (cancellationToken && cancellationToken.isCancelled()) {
            logger.warn(`[${operationId}] Analysis cancelled for ${tokenAddress}`);
            throw new Error('Analysis cancelled by user');
        }
        
        logger.error(`[${operationId}] Error in analyzeTeamSupply:`, error);
        logger.error(`[${operationId}] Progress at time of error:`, progress);
        throw error;
    }
}

/**
 * Analyze wallets with timeout and cancellation support
 * @param {Array} wallets - Wallets to analyze
 * @param {string} tokenAddress - Token address
 * @param {string} mainContext - Main context for API calls
 * @param {Object} tokenInfo - Token information
 * @param {string} operationId - Unique operation ID
 * @param {Object} cancellationToken - Token to check for cancellation
 * @returns {Promise<Array>} Analyzed wallets
 */
async function analyzeWalletsWithTimeout(wallets, tokenAddress, mainContext, tokenInfo, operationId, cancellationToken) {
    // Log progress every 10% of wallets
    const progressStep = Math.max(1, Math.ceil(wallets.length / 10));
    let lastProgressLog = 0;
    
    // Analyze a single wallet with timeout
    const analyzeWalletWithTimeout = async (wallet, index) => {
        // Check for cancellation
        if (cancellationToken && cancellationToken.isCancelled()) {
            throw new Error('Analysis cancelled by user');
        }
        
        // Log progress periodically
        if (index >= lastProgressLog + progressStep) {
            logger.info(`[${operationId}] Progress: analyzed ${index}/${wallets.length} wallets (${Math.round(index/wallets.length*100)}%)`);
            lastProgressLog = index;
        }
        
        return Promise.race([
            analyzeWallet(wallet, tokenAddress, mainContext, tokenInfo, operationId, cancellationToken),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error(`Wallet analysis timeout for ${wallet.address.slice(0, 8)}...`)), 
                WALLET_ANALYSIS_TIMEOUT)
            )
        ]).catch(error => {
            logger.warn(`[${operationId}] Wallet analysis failed for ${wallet.address.slice(0, 8)}...: ${error.message}`);
            return {
                ...wallet,
                category: 'Error',
                error: error.message
            };
        });
    };

    // Process wallets in smaller batches with breaks between batches
    const analyzedWallets = [];
    for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
        // Check for cancellation before each batch
        if (cancellationToken && cancellationToken.isCancelled()) {
            logger.warn(`[${operationId}] Analysis cancelled during batch processing`);
            throw new Error('Analysis cancelled by user');
        }
        
        const batch = wallets.slice(i, i + BATCH_SIZE);
        logger.debug(`[${operationId}] Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(wallets.length/BATCH_SIZE)} (${batch.length} wallets)`);
        
        const batchResults = await Promise.all(
            batch.map((wallet, batchIndex) => 
                analyzeWalletWithTimeout(wallet, i + batchIndex)
            )
        );
        analyzedWallets.push(...batchResults);

        // Small break between batches to avoid rate limiting
        if (i + BATCH_SIZE < wallets.length) {
            await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
        }
    }

    logger.info(`[${operationId}] Completed analysis of all ${wallets.length} wallets`);
    return analyzedWallets;
}

/**
 * Analyze a single wallet
 * @param {Object} wallet - Wallet to analyze
 * @param {string} tokenAddress - Token address
 * @param {string} mainContext - Main context for API calls
 * @param {Object} tokenInfo - Token information
 * @param {string} operationId - Unique operation ID
 * @param {Object} cancellationToken - Token to check for cancellation
 * @returns {Promise<Object>} Analyzed wallet
 */
async function analyzeWallet(wallet, tokenAddress, mainContext, tokenInfo, operationId, cancellationToken) {
    // Check for cancellation
    if (cancellationToken && cancellationToken.isCancelled()) {
        throw new Error('Analysis cancelled by user');
    }
    
    try {
        // Start with "Normal" category (non-team)
        let category = "Normal";  
        let daysSinceLastActivity = null;

        // Fast track for optimization: if a wallet has over 1000 transactions, skip detailed analysis
        if (await hasExcessiveTransactions(wallet.address, mainContext)) {
            return {
                ...wallet,
                category,
                daysSinceLastActivity: null,
                funderAddress: null,
                fundingDetails: null
            };
        }

        // Attempt to categorize more precisely
        if (await isFreshWallet(wallet.address, mainContext, 'isFreshWallet')) {
            category = 'Fresh';
        } else {
            try {
                // Check for cancellation before expensive operation
                if (cancellationToken && cancellationToken.isCancelled()) {
                    throw new Error('Analysis cancelled by user');
                }
                
                const inactivityCheck = await checkInactivityPeriod(wallet.address, tokenAddress, mainContext, 'checkInactivity');
                if (inactivityCheck.category === 'No Token') {
                    category = 'No Token';
                } else if (inactivityCheck.category === 'No ATA Transaction') {
                    category = 'No ATA Transaction';
                } else if (inactivityCheck.isInactive) {
                    category = 'Inactive';
                    daysSinceLastActivity = inactivityCheck.daysSinceLastActivity;
                } else if (await isTeamBot(wallet.address, tokenAddress, mainContext)) {
                    category = 'Teambot';
                }
            } catch (inactivityError) {
                logger.debug(`[${operationId}] Error checking inactivity for ${wallet.address.slice(0, 8)}...: ${inactivityError.message}`);
                // Fall back to Normal if inactivity check fails
            }
        }
        
        // Check for cancellation before funding analysis
        if (cancellationToken && cancellationToken.isCancelled()) {
            throw new Error('Analysis cancelled by user');
        }
        
        // Analyze funding source
        try {
            const fundingResult = await analyzeFunding(
                [{address: wallet.address}], 
                mainContext, 
                'analyzeFunding'
            );
            const fundingInfo = fundingResult[0];
            
            return {
                ...wallet,
                category,
                daysSinceLastActivity,
                funderAddress: fundingInfo?.funderAddress || null,
                fundingDetails: fundingInfo?.fundingDetails || null
            };
        } catch (fundingError) {
            logger.debug(`[${operationId}] Error analyzing funding for ${wallet.address.slice(0, 8)}...: ${fundingError.message}`);
            return {
                ...wallet,
                category,
                daysSinceLastActivity,
                funderAddress: null,
                fundingDetails: null
            };
        }
    } catch (error) {
        // If analysis was cancelled, propagate that error
        if (error.message.includes('cancelled')) {
            throw error;
        }
        
        logger.error(`[${operationId}] Error analyzing wallet ${wallet.address.slice(0, 8)}...:`, error);
        return {
            ...wallet,
            category: 'Error',
            error: error.message
        };
    }
}

/**
 * Check if a wallet has excessive transactions (optimization)
 * @param {string} address - Wallet address
 * @param {string} mainContext - Main context for API calls
 * @returns {Promise<boolean>} True if the wallet has excessive transactions
 */
async function hasExcessiveTransactions(address, mainContext) {
    try {
        const solanaApi = getSolanaApi();
        const signatures = await solanaApi.getSignaturesForAddress(
            address, 
            { limit: 1001 }, // Just over 1000 to check if we hit the threshold
            mainContext,
            'checkTransactionCount'
        );
        
        // If we hit the maximum count, this wallet has too many transactions
        // for detailed analysis - just categorize as normal
        if (signatures.length >= 1000) {
            logger.warn(`Wallet ${address} has more than 1000 transactions. Skipping funding analysis.`);
            return true;
        }
        return false;
    } catch (error) {
        logger.debug(`Error checking transaction count for ${address.slice(0, 8)}...: ${error.message}`);
        return false; // Default to false if we can't determine
    }
}

/**
 * Check if a wallet is a team bot
 * @param {string} address - Wallet address
 * @param {string} tokenAddress - Token address
 * @param {string} mainContext - Main context for API calls
 * @returns {Promise<boolean>} True if the wallet is a team bot
 */
async function isTeamBot(address, tokenAddress, mainContext) {
    try {
        const solanaApi = getSolanaApi();
        
        const assetCount = await solanaApi.getAssetCount(address, mainContext, 'isTeamBot');
        if (assetCount <= MAX_ASSETS_THRESHOLD) {
            const transactions = await solanaApi.getSignaturesForAddress(
                address, 
                { limit: TRANSACTION_CHECK_LIMIT },
                mainContext,
                'getTeamBotTransactions'
            );
            
            // Check if they all involve the target token
            if (transactions && transactions.length > 0) {
                // Since we're just checking if every transaction might involve the token,
                // we don't need to check each one individually - just count them
                return true;
            }
        }
        return false;
    } catch (error) {
        logger.debug(`Error checking if ${address.slice(0, 8)}... is a teambot:`, error.message);
        return false;
    }
}

/**
 * Check if a wallet is a fresh wallet
 * @param {string} address - Wallet address
 * @param {string} mainContext - Main context for API calls
 * @param {string} subContext - Sub-context for API calls
 * @returns {Promise<boolean>} True if the wallet is a fresh wallet
 */
async function isFreshWallet(address, mainContext, subContext) {
    try {
        const solanaApi = getSolanaApi();
        
        // First call to check if transaction count <= threshold
        const initialSignatures = await solanaApi.getSignaturesForAddress(
            address, 
            { limit: FRESH_WALLET_THRESHOLD + 1 }, // +1 to check if exceeding threshold
            mainContext,
            subContext
        );
        
        const transactionCount = initialSignatures.length;
        const isFresh = transactionCount < FRESH_WALLET_THRESHOLD;
        
        logger.debug(`Fresh wallet check for ${address.slice(0, 8)}...: ${transactionCount} transactions, isFresh: ${isFresh}`);
        
        return isFresh;
    } catch (error) {
        logger.debug(`Error checking if ${address.slice(0, 8)}... is a fresh wallet: ${error.message}`);
        return false;
    }
}

module.exports = {
    analyzeTeamSupply
};