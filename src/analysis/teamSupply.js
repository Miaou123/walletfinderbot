const { getSolanaApi } = require('../integrations/solanaApi');
const gmgnApi = require('../integrations/gmgnApi');
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
const BATCH_SIZE = 20; // Augmenté pour profiter du rate limit plus élevé

async function analyzeTeamSupply(tokenAddress, mainContext = 'default') {
    logger.debug(`Starting team supply analysis for ${tokenAddress}`, { mainContext });

    try {
        // Exécuter les appels initiaux en parallèle
        const [tokenInfoResponse, allHolders] = await Promise.all([
            gmgnApi.getTokenInfo(tokenAddress, mainContext, 'getTokenInfo'),
            getHolders(tokenAddress, mainContext, 'getHolders')
        ]);

        if (!tokenInfoResponse?.data?.token) {
            throw new Error("Failed to fetch token information");
        }
        const tokenInfo = tokenInfoResponse.data.token;
        const totalSupply = new BigNumber(tokenInfo.total_supply);

        // Filtrer les holders significatifs
        const significantHolders = allHolders.filter(holder => {
            const balance = new BigNumber(holder.balance);
            const percentage = balance.dividedBy(totalSupply);
            return percentage.isGreaterThanOrEqualTo(SUPPLY_THRESHOLD);
        });

        // Pré-fetch des données en masse
        const solanaApi = getSolanaApi();
        const walletsToAnalyze = significantHolders.map(h => h.address);
        
        // Récupérer toutes les signatures et asset counts en parallèle
        const [allSignatures, allAssetCounts] = await Promise.all([
            batchGetSignatures(walletsToAnalyze, mainContext),
            batchGetAssetCounts(walletsToAnalyze, mainContext)
        ]);

        // Analyser les wallets avec les données pré-fetchées
        const analyzedWallets = await analyzeWalletsOptimized(
            significantHolders,
            tokenAddress,
            mainContext,
            allSignatures,
            allAssetCounts
        );

        // Le reste du code reste identique
        const teamWallets = analyzedWallets
            .filter(w => w.category !== 'Unknown')
            .map(w => ({
                address: w.address,
                balance: w.balance,
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

// Nouvelle fonction pour récupérer les signatures en batch
async function batchGetSignatures(addresses, mainContext) {
    const solanaApi = getSolanaApi();
    const signaturePromises = addresses.map(address => 
        solanaApi.getSignaturesForAddress(
            address,
            { limit: FRESH_WALLET_THRESHOLD + 1 },
            mainContext,
            'batchSignatures'
        ).catch(error => {
            logger.error(`Error getting signatures for ${address}:`, error);
            return [];
        })
    );

    const signatures = await Promise.all(signaturePromises);
    return addresses.reduce((acc, address, index) => {
        acc[address] = signatures[index];
        return acc;
    }, {});
}

// Nouvelle fonction pour récupérer les asset counts en batch
async function batchGetAssetCounts(addresses, mainContext) {
    const solanaApi = getSolanaApi();
    const assetCountPromises = addresses.map(address =>
        solanaApi.getAssetCount(address, mainContext, 'batchAssetCounts')
            .catch(error => {
                logger.error(`Error getting asset count for ${address}:`, error);
                return 0;
            })
    );

    const assetCounts = await Promise.all(assetCountPromises);
    return addresses.reduce((acc, address, index) => {
        acc[address] = assetCounts[index];
        return acc;
    }, {});
}

// Version optimisée de analyzeWallets
async function analyzeWalletsOptimized(wallets, tokenAddress, mainContext, preloadedSignatures, preloadedAssetCounts) {
    const analyzeWallet = async (wallet) => {
        try {
            let category = 'Unknown';
            let daysSinceLastActivity = null;

            // Utiliser les données pré-chargées
            const signatures = preloadedSignatures[wallet.address] || [];
            const assetCount = preloadedAssetCounts[wallet.address] || 0;

            if (signatures.length <= FRESH_WALLET_THRESHOLD) {
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
                } else if (assetCount <= MAX_ASSETS_THRESHOLD) {
                    // Vérification simplifiée du teambot
                    const solanaApi = getSolanaApi();
                    const transactions = await solanaApi.getSignaturesForAddress(
                        wallet.address,
                        { limit: TRANSACTION_CHECK_LIMIT },
                        mainContext,
                        'teamBotCheck'
                    );
                    
                    const hasOnlyTokenTransactions = transactions.every(tx => 
                        tx?.meta?.postTokenBalances?.some(balance => 
                            balance.mint === tokenAddress
                        ) ?? false
                    );

                    if (hasOnlyTokenTransactions) {
                        category = 'Teambot';
                    }
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

    // Traitement en lots plus grands
    const analyzedWallets = [];
    for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
        const batch = wallets.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(analyzeWallet));
        analyzedWallets.push(...batchResults);
    }

    return analyzedWallets;
}

module.exports = {
    analyzeTeamSupply
};