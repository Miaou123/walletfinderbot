// src/analysis/freshWallets.js
const { getSolanaApi } = require('../integrations/solanaApi');
const { getHolders } = require('../tools/getHolders');
const { analyzeFunding } = require('../tools/fundingAnalyzer'); // Import funding analyzer
const BigNumber = require('bignumber.js');
const logger = require('../utils/logger');

// Configuration
BigNumber.config({ DECIMAL_PLACES: 18, ROUNDING_MODE: BigNumber.ROUND_DOWN });

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

// Constants
const FRESH_WALLET_THRESHOLD = 100;
const SUPPLY_THRESHOLD = new BigNumber('0.0005'); // 0.1%

async function analyzeFreshWallets(tokenAddress, mainContext = 'default') {
    logger.debug(`Starting fresh wallets analysis for ${tokenAddress}`, { mainContext });

    try {
        // Fetch token info from Helius
        logger.debug('Fetching token info from Helius...');
        const solanaApi = getSolanaApi();
        const assetInfo = await solanaApi.getAsset(tokenAddress, mainContext, 'analyzeFreshWallets');
        
        if (!assetInfo) {
            throw new Error("No token info found");
        }

        const tokenInfo = {
            total_supply: assetInfo.supply.total, // Already adjusted with decimals
            symbol: assetInfo.symbol,
            name: assetInfo.name,
            decimals: assetInfo.decimals
        };

        logger.debug('Token info received:', tokenInfo);

        const totalSupply = new BigNumber(tokenInfo.total_supply);
        const allHolders = await getHolders(tokenAddress, mainContext, 'getHolders');
        
        // Filter holders with significant balances
        const significantHolders = allHolders.filter(holder => {
            if (KNOWN_LP_POOLS.has(holder.address)) {
                return false;
            }

            const rawBalance = new BigNumber(holder.balance);
            const percentage = rawBalance.dividedBy(totalSupply);
            return percentage.isGreaterThanOrEqualTo(SUPPLY_THRESHOLD);
        });

        logger.debug('Significant holders found:', {
            count: significantHolders.length,
            threshold: SUPPLY_THRESHOLD.multipliedBy(100).toString() + '%'
        });

        // Analyze wallets to find fresh ones
        const analyzedWallets = await analyzeWallets(significantHolders, tokenAddress, mainContext);
        logger.debug('Analyzed wallets results:', {
            total: analyzedWallets.length,
            freshWallets: analyzedWallets.filter(w => w.category === 'Fresh').length
        });    

        // Filter only fresh wallets
        const freshWallets = analyzedWallets
            .filter(w => w.category === 'Fresh')
            .map(w => ({
                address: w.address,
                balance: w.balance.toString(),
                percentage: new BigNumber(w.balance)
                    .dividedBy(totalSupply)
                    .multipliedBy(100)
                    .toNumber(),
                funderAddress: w.funderAddress || null,
                fundingDetails: w.fundingDetails || null
            }));
        
        // Calculate total supply held by fresh wallets
        const freshSupplyHeld = analyzedWallets
            .filter(w => w.category === 'Fresh')
            .reduce((total, wallet) => {
                return total.plus(new BigNumber(wallet.balance));
            }, new BigNumber(0));
        
        const totalSupplyControlled = freshSupplyHeld
            .dividedBy(totalSupply)
            .multipliedBy(100)
            .toNumber();

        return {
            scanData: {
                tokenInfo: {
                    totalSupply: tokenInfo.total_supply,
                    symbol: tokenInfo.symbol,
                    name: tokenInfo.name,
                    decimals: tokenInfo.decimals,
                    address: tokenAddress
                },
                analyzedWallets,
                freshWallets,
                totalSupplyControlled,
                tokenAddress
            },
            trackingInfo: {
                tokenAddress,
                tokenSymbol: tokenInfo.symbol,
                totalSupply: tokenInfo.total_supply,
                decimals: tokenInfo.decimals,
                totalSupplyControlled,
                freshWallets,
                allWalletsDetails: analyzedWallets
            }
        };

    } catch (error) {
        logger.error('Error in analyzeFreshWallets:', error);
        throw error;
    }
}

async function analyzeWallets(wallets, tokenAddress, mainContext) {
    const analyzeWallet = async (wallet) => {
        try {
            let category = 'Unknown';

            if (await isFreshWallet(wallet.address, mainContext, 'isFreshWallet')) {
                category = 'Fresh';
                
                // For fresh wallets, analyze funding source
                try {
                    // Get funding information using fundingAnalyzer
                    const fundingResult = await analyzeFunding([{address: wallet.address}], mainContext, 'analyzeFunding');
                    const fundingInfo = fundingResult[0];
                    
                    return {
                        ...wallet,
                        category,
                        funderAddress: fundingInfo?.funderAddress || null,
                        fundingDetails: fundingInfo?.fundingDetails || null
                    };
                } catch (fundingError) {
                    logger.error(`Error analyzing funding for wallet ${wallet.address}:`, fundingError);
                    return {
                        ...wallet,
                        category,
                        funderAddress: null,
                        fundingDetails: null
                    };
                }
            }

            return {
                ...wallet,
                category
            };
        } catch (error) {
            logger.error(`Error analyzing wallet ${wallet.address}:`, error);
            return {
                ...wallet,
                category: 'Error',
                error: error.message
            };
        }
    };

    const batchSize = 10;
    const analyzedWallets = [];

    for (let i = 0; i < wallets.length; i += batchSize) {
        const batch = wallets.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(analyzeWallet));
        analyzedWallets.push(...batchResults);

        if (i + batchSize < wallets.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    return analyzedWallets;
}

async function isFreshWallet(address, mainContext, subContext) {
    try {
        const solanaApi = getSolanaApi();
        
        // Get transactions and check if count is below threshold
        const initialSignatures = await solanaApi.getSignaturesForAddress(
            address, 
            { limit: FRESH_WALLET_THRESHOLD + 1 }, // +1 to check if we exceed the threshold
            mainContext,
            subContext
        );
        
        const transactionCount = initialSignatures.length;
        const isFresh = transactionCount < FRESH_WALLET_THRESHOLD;
        
        logger.debug(`Fresh wallet check for ${address}: found ${transactionCount} transactions, isFresh: ${isFresh}`, {
            mainContext,
            subContext,
            address,
            transactionCount,
            threshold: FRESH_WALLET_THRESHOLD
        });
        
        return isFresh;
    } catch (error) {
        logger.error(`Error checking if ${address} is a fresh wallet:`, error, {
            mainContext,
            subContext,
            address
        });
        return false;
    }
}

module.exports = {
    analyzeFreshWallets
};