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

async function analyzeTeamSupply(tokenAddress, mainContext = 'default') {
    logger.debug(`Starting team supply analysis for ${tokenAddress}`, { mainContext });

    try {
        // 1. Récupérer les informations du token via GMGN API
        const tokenInfoResponse = await gmgnApi.getTokenInfo(tokenAddress, mainContext, 'getTokenInfo');
        if (!tokenInfoResponse || !tokenInfoResponse.data || !tokenInfoResponse.data.token) {
            throw new Error("Failed to fetch token information");
        }
        const tokenInfo = tokenInfoResponse.data.token;
        const totalSupply = new BigNumber(tokenInfo.total_supply);

        // 2. Récupérer tous les holders
        const allHolders = await getHolders(tokenAddress, mainContext, 'getHolders');
        
        // 3. Filtrer les holders significatifs
        const significantHolders = allHolders.filter(holder => {
            const balance = new BigNumber(holder.balance);
            const percentage = balance.dividedBy(totalSupply);
            return percentage.isGreaterThanOrEqualTo(SUPPLY_THRESHOLD);
        });

        // 4. Analyser chaque wallet
        const analyzedWallets = await analyzeWallets(significantHolders, tokenAddress, mainContext);

        // 5. Identifier les wallets de l'équipe et calculer les totaux
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

        // 6. Calculer le total contrôlé
        const teamSupplyHeld = analyzedWallets
            .filter(w => w.category !== 'Unknown')
            .reduce((total, wallet) => {
                return total.plus(new BigNumber(wallet.balance));
            }, new BigNumber(0));

        const totalSupplyControlled = teamSupplyHeld
            .dividedBy(totalSupply)
            .multipliedBy(100)
            .toNumber();

        // 7. Retourner les données
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