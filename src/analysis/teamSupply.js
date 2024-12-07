const { getSolanaApi } = require('../integrations/solanaApi');
const { checkInactivityPeriod } = require('../tools/inactivityPeriod');
const { getHolders } = require('../tools/getHolders');
const BigNumber = require('bignumber.js');
const logger = require('../utils/logger');

// Configuration
BigNumber.config({ DECIMAL_PLACES: 18, ROUNDING_MODE: BigNumber.ROUND_DOWN });

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
            decimals: assetInfo.decimals
        };

        logger.debug('Token info received:', tokenInfo);

        const totalSupply = new BigNumber(tokenInfo.total_supply);
        const allHolders = await getHolders(tokenAddress, mainContext, 'getHolders');
        
             // Ajout de logs pour le filtrage
             const significantHolders = allHolders.filter(holder => {
                const rawBalance = new BigNumber(holder.balance);
                const percentage = rawBalance.dividedBy(totalSupply);
                const percentageNumber = percentage.multipliedBy(100).toNumber();
            
                logger.debug('Detailed holder analysis:', {
                    address: holder.address,
                    rawBalance: rawBalance.toString(),
                    decimals: tokenInfo.decimals,
                    totalSupply: totalSupply.toString(),
                    percentage: percentageNumber,
                    calculation: {
                        step1_rawBalance: rawBalance.toString(),
                        step2_powerOfDecimals: new BigNumber(10).pow(tokenInfo.decimals).toString(),
                        step4_totalSupply: totalSupply.toString(),
                    },
                    threshold: SUPPLY_THRESHOLD.multipliedBy(100).toNumber(),
                    isSignificant: percentage.isGreaterThanOrEqualTo(SUPPLY_THRESHOLD)
                });
            
                return percentage.isGreaterThanOrEqualTo(SUPPLY_THRESHOLD);
            });
    
    
            logger.debug('Significant holders found:', {
                count: significantHolders.length,
                threshold: SUPPLY_THRESHOLD.multipliedBy(100).toString() + '%'
            });
    
            const analyzedWallets = await analyzeWallets(significantHolders, tokenAddress, mainContext);
            logger.debug('Analyzed wallets results:', {
                total: analyzedWallets.length,
                byCategory: analyzedWallets.reduce((acc, w) => {
                    acc[w.category] = (acc[w.category] || 0) + 1;
                    return acc;
                }, {})
            });    

            const teamWallets = analyzedWallets
            .filter(w => w.category !== 'Unknown')
            .map(w => ({
                address: w.address,
                balance: w.balance.toString(),
                percentage: new BigNumber(w.balance)
                    .dividedBy(totalSupply)
                    .multipliedBy(100)
                    .toNumber()
            }));
        
        const teamSupplyHeld = analyzedWallets
            .filter(w => w.category !== 'Unknown')
            .reduce((total, wallet) => {
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
                    decimals: tokenInfo.decimals
                },
                analyzedWallets,
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
                allWalletsDetails: analyzedWallets
            }
        };

    } catch (error) {
        logger.error('Error in analyzeTeamSupply:', error);
        throw error;
    }
}

// Les fonctions auxiliaires restent identiques
async function analyzeWallets(wallets, tokenAddress, mainContext) {
    const analyzeWallet = async (wallet) => {
        try {
            let category = 'Unknown';
            let daysSinceLastActivity = null;

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
            }

            return {
                ...wallet,
                category,
                daysSinceLastActivity
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
            
            const hasOnlyTokenTransactions = transactions.every(tx => 
                tx?.meta?.postTokenBalances?.some(balance => 
                    balance.mint === tokenAddress
                ) ?? false
            );

            return hasOnlyTokenTransactions;
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
        const signatures = await solanaApi.getSignaturesForAddress(
            address, 
            { limit: FRESH_WALLET_THRESHOLD + 1 },
            mainContext,
            subContext
        );
        return signatures.length <= FRESH_WALLET_THRESHOLD;
    } catch (error) {
        logger.error(`Error checking if ${address} is a fresh wallet:`, error);
        return false;
    }
}

module.exports = {
    analyzeTeamSupply
};