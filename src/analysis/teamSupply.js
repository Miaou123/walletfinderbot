// src/analysis/teamSupply.js
const { getSolanaApi } = require('../integrations/solanaApi');
const { checkInactivityPeriod } = require('../tools/inactivityPeriod');
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
const TRANSACTION_CHECK_LIMIT = 20;
const MAX_ASSETS_THRESHOLD = 2;
const SUPPLY_THRESHOLD = new BigNumber('0.001'); // 0.1%

async function analyzeTeamSupply(tokenAddress, mainContext = 'default') {
    logger.debug(`Starting team supply analysis for ${tokenAddress}`, { mainContext });

    try {
        // Utiliser la nouvelle méthode getAsset de Helius
        logger.debug('Fetching token info from Helius...');
        const solanaApi = getSolanaApi();
        const assetInfo = await solanaApi.getAsset(tokenAddress, mainContext, 'analyzeTeamSupply');
        
        if (!assetInfo) {
            throw new Error("No token info found");
        }

        const tokenInfo = {
            total_supply: assetInfo.supply.total, // Déjà ajusté avec les décimales
            symbol: assetInfo.symbol,
            name: assetInfo.name,
            decimals: assetInfo.decimals,
            address: tokenAddress  // Ajouté l'adresse du token
        };

        logger.debug('Token info received:', tokenInfo);

        const totalSupply = new BigNumber(tokenInfo.total_supply);
        const allHolders = await getHolders(tokenAddress, mainContext, 'getHolders');
        
        // Filtre les wallets de pool de liquidité et les holdings non significatifs
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
    
        // Analyser chaque wallet significatif
        const analyzedWallets = await analyzeWallets(significantHolders, tokenAddress, mainContext, tokenInfo);
        
        // Filtre uniquement les wallets qui sont catégorisés (non-normaux)
        // CHANGEMENT CRUCIAL: Nous filtrons explicitement les wallets "Normal" 
        const teamWallets = analyzedWallets
            .filter(w => w.category !== 'Normal' && w.category !== 'Unknown') 
            .map(w => ({
                address: w.address,
                balance: w.balance.toString(),
                percentage: new BigNumber(w.balance)
                    .dividedBy(totalSupply)
                    .multipliedBy(100)
                    .toNumber(),
                category: w.category,
                funderAddress: w.funderAddress || null,
                fundingDetails: w.fundingDetails || null
            }));

        logger.debug(`Filtered ${teamWallets.length} team wallets out of ${analyzedWallets.length} analyzed wallets`);
        
        // Calcule la supply contrôlée par les wallets "team"
        const teamSupplyHeld = teamWallets.reduce((total, wallet) => {
            return total.plus(new BigNumber(wallet.balance));
        }, new BigNumber(0));
        
        const totalSupplyControlled = teamSupplyHeld
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
                analyzedWallets: teamWallets,  // Uniquement les wallets team
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
                allWalletsDetails: teamWallets  // Uniquement les wallets team
            }
        };

    } catch (error) {
        logger.error('Error in analyzeTeamSupply:', error);
        throw error;
    }
}

// Les fonctions auxiliaires restent identiques
async function analyzeWallets(wallets, tokenAddress, mainContext, tokenInfo) {
    const analyzeWallet = async (wallet) => {
        try {
            // Par défaut, on considère les wallets comme "Normal" (non-team)
            let category = "Normal";  
            let daysSinceLastActivity = null;

            // Tenter de classifier plus précisément
            if (await isFreshWallet(wallet.address, mainContext, 'isFreshWallet')) {
                category = 'Fresh';
            } else {
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
                // Si aucune des conditions n'est remplie, reste "Normal"
            }
            
            // Analyze funding source for all wallets
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
                logger.error(`Error analyzing funding for wallet ${wallet.address}:`, fundingError);
                return {
                    ...wallet,
                    category,
                    daysSinceLastActivity,
                    funderAddress: null,
                    fundingDetails: null
                };
            }
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

    // Log pour debug
    const categoryCounts = analyzedWallets.reduce((counts, wallet) => {
        counts[wallet.category] = (counts[wallet.category] || 0) + 1;
        return counts;
    }, {});
    
    logger.debug('Analyzed wallets categories:', categoryCounts);

    return analyzedWallets;
}

async function isTeamBot(address, tokenAddress, mainContext) {
    const solanaApi = getSolanaApi();
    try {
        const assetCount = await solanaApi.getAssetCount(address, mainContext, 'isTeamBot');
        if (assetCount <= MAX_ASSETS_THRESHOLD) {
            const transactions = await solanaApi.getSignaturesForAddress(
                address, 
                { limit: TRANSACTION_CHECK_LIMIT },
                mainContext,
                'getTeamBotTransactions'
            );
            
            // S'il y a des transactions, vérifier si elles impliquent toutes le token cible
            if (transactions && transactions.length > 0) {
                const hasOnlyTokenTransactions = transactions.every(tx => 
                    tx?.meta?.postTokenBalances?.some(balance => 
                        balance.mint === tokenAddress
                    ) ?? false
                );
                
                return hasOnlyTokenTransactions;
            }
        }
        return false;
    } catch (error) {
        logger.error(`Error checking if ${address} is a teambot:`, error);
        return false;
    }
}

async function isFreshWallet(address, mainContext, subContext) {
    try {
        const solanaApi = getSolanaApi();
        
        // Premier appel pour vérifier si le nombre de transactions est <= au seuil
        const initialSignatures = await solanaApi.getSignaturesForAddress(
            address, 
            { limit: FRESH_WALLET_THRESHOLD + 1 }, // +1 pour vérifier si on dépasse le seuil
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
    analyzeTeamSupply
};