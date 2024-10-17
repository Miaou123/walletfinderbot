const pumpfunApi = require('../integrations/pumpfunApi');
const { getSolanaApi } = require('../integrations/solanaApi');
const gmgnApi = require('../integrations/gmgnApi');
const { analyzeFunding } = require('../tools/fundingAnalyzer');
const config = require('../utils/config');
const logger = require('../utils/logger');

const FRESH_WALLET_THRESHOLD = 10;
const TOKEN_THRESHOLD = 2;

async function analyzeBundle(address, limit = 50000, isTeamAnalysis = false) {
    const solanaApi = getSolanaApi();
    
    const TOKEN_DECIMALS = config.PUMPFUN_DECIMALS;
    const SOL_DECIMALS = config.SOL_DECIMALS;
    const TOKEN_FACTOR = Math.pow(10, TOKEN_DECIMALS);
    const SOL_FACTOR = Math.pow(10, SOL_DECIMALS);

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
    let totalTokensBundled = 0;
    let totalSolSpent = 0;

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
            const tokenAmount = trade.token_amount / TOKEN_FACTOR;
            bundles[trade.slot].tokensBought += tokenAmount;
            bundles[trade.slot].solSpent += trade.sol_amount / SOL_FACTOR;
            bundles[trade.slot].transactions.push(trade);
        }
    });

    logger.debug(`Total bundles before filtering: ${Object.keys(bundles).length}`);

    const filteredBundles = Object.entries(bundles)
    .filter(([_, bundle]) => {
        const walletSize = bundle.uniqueWallets.size;
        logger.debug(`Bundle wallet size: ${walletSize}`);
        return walletSize >= 2;
    })
    .map(([slot, bundle]) => {
        logger.debug(`Processing bundle for slot ${slot}`);
        logger.debug(`Unique wallets before mapping: ${bundle.uniqueWallets.size}`);
        return {
            slot: parseInt(slot),
            uniqueWallets: bundle.uniqueWallets,  
            uniqueWalletsCount: bundle.uniqueWallets.size,
            tokensBought: bundle.tokensBought,
            solSpent: bundle.solSpent,
            transactions: bundle.transactions
        };
    })
    .sort((a, b) => b.tokensBought - a.tokensBought);

    logger.debug(`Filtered bundles: ${filteredBundles.length}`);

    // Fetch token info from GMGN API
    const gmgnTokenInfo = await gmgnApi.getTokenInfo(address);
    logger.debug(`Token info: ${JSON.stringify(gmgnTokenInfo, null, 2)}`);

    // Adapt GMGN token info to the format expected by the rest of the code
    const tokenInfo = {
        name: gmgnTokenInfo.data.token.name,
        symbol: gmgnTokenInfo.data.token.symbol,
        totalSupply: gmgnTokenInfo.data.token.total_supply || 1000000000,
        decimals: gmgnTokenInfo.data.token.decimals,
        priceUsd: gmgnTokenInfo.data.token.price,
    };
    
    logger.debug(`Token info: ${JSON.stringify(tokenInfo, null, 2)}`);

    const totalSupply = parseFloat(tokenInfo.totalSupply);

    if (isTeamAnalysis) {
        logger.debug('Starting team analysis');
        const teamWallets = new Set();
        const allWallets = new Set(filteredBundles.flatMap(bundle => Array.from(bundle.uniqueWallets)));

        // Analyser le funding pour tous les wallets en une seule fois
        const walletsToAnalyze = Array.from(allWallets).map(address => ({ address }));
        const fundingResults = await analyzeFunding(walletsToAnalyze, 'bundle', 'teamAnalysis');

        // Créer une Map pour stocker les funders
        const funderMap = new Map();

        for (const result of fundingResults) {
            const { address, funderAddress } = result;
            if (funderAddress) {
                if (!funderMap.has(funderAddress)) {
                    funderMap.set(funderAddress, new Set());
                }
                funderMap.get(funderAddress).add(address);
            }

            if (await isTeamWallet(address, funderAddress)) {
                teamWallets.add(address);
            }
        }

        // Ajouter aux teamWallets les wallets qui partagent un funder commun
        for (const [funder, wallets] of funderMap.entries()) {
            if (wallets.size > 1) {
                logger.debug(`Found ${wallets.size} wallets sharing funder ${funder}`);
                for (const wallet of wallets) {
                    teamWallets.add(wallet);
                }
            }
        }

        logger.debug(`Identified ${teamWallets.size} team wallets`);

        const teamBundles = filteredBundles.map(bundle => {
            const teamWalletsInBundle = Array.from(bundle.uniqueWallets).filter(wallet => teamWallets.has(wallet));
            if (teamWalletsInBundle.length > 0) {
                return {
                    ...bundle,
                    uniqueWallets: new Set(teamWalletsInBundle),
                    uniqueWalletsCount: teamWalletsInBundle.length,
                    tokensBought: bundle.transactions
                        .filter(tx => teamWalletsInBundle.includes(tx.user))
                        .reduce((sum, tx) => sum + tx.token_amount / TOKEN_FACTOR, 0),
                    solSpent: bundle.transactions
                        .filter(tx => teamWalletsInBundle.includes(tx.user))
                        .reduce((sum, tx) => sum + tx.sol_amount / SOL_FACTOR, 0)
                };
            }
            return null;
        }).filter(bundle => bundle !== null);
        
        // Puis, mettez à jour les calculs totaux :
        totalTokensBundled = teamBundles.reduce((sum, bundle) => sum + bundle.tokensBought, 0);
        totalSolSpent = teamBundles.reduce((sum, bundle) => sum + bundle.solSpent, 0);
        

        // Recalculer les holdings pour les wallets de l'équipe
        const teamHoldings = await calculateTeamHoldings(Array.from(teamWallets), address, TOKEN_DECIMALS);

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
            isTeamAnalysis
        };
    } else {
        // Calculate total tokens bundled from filtered bundles
        totalTokensBundled = filteredBundles.reduce((sum, bundle) => sum + bundle.tokensBought, 0);
        totalSolSpent = filteredBundles.reduce((sum, bundle) => sum + bundle.solSpent, 0);

        logger.debug(`Total tokens bundled: ${totalTokensBundled}`);
        logger.debug(`Total SOL spent: ${totalSolSpent}`);

        const percentageBundled = (totalTokensBundled / totalSupply) * 100;

        // Get current holdings for all bundles
        const allBundles = await Promise.all(filteredBundles.map(async (bundle, index) => {
            logger.debug(`Processing bundle ${index + 1} with ${bundle.uniqueWallets.size} unique wallets`);
            
            const holdingAmounts = await Promise.all(
                Array.from(bundle.uniqueWallets).map(async (wallet) => {
                    logger.debug(`Fetching token accounts for wallet: ${wallet}`);
                    const tokenAccounts = await solanaApi.getTokenAccountsByOwner(wallet, address);
                    logger.debug(`Found ${tokenAccounts.length} token accounts for wallet ${wallet}`);
                    
                    const balances = await Promise.all(
                        tokenAccounts.map(async (account) => {
                            const balance = await solanaApi.getTokenAccountBalance(account.pubkey, { commitment: 'confirmed' });
                            logger.debug(`Balance for account ${account.pubkey}: ${JSON.stringify(balance)}`);
                            return balance;
                        })
                    );
                    
                    const totalBalance = balances.reduce((sum, balance) => {
                        if (balance && balance.amount) {
                            return sum + BigInt(balance.amount);
                        }
                        return sum;
                    }, BigInt(0));
                    
                    logger.debug(`Total balance for wallet ${wallet}: ${totalBalance.toString()}`);
                    return totalBalance;
                })
            );

            const totalHolding = holdingAmounts.reduce((sum, amount) => sum + amount, BigInt(0));
            const totalHoldingNumber = Number(totalHolding) / Math.pow(10, TOKEN_DECIMALS);

            logger.debug(`Bundle ${index + 1} total holding: ${totalHoldingNumber} (${totalHolding.toString()} raw)`);
            logger.debug(`Token decimals: ${TOKEN_DECIMALS}, Total supply: ${totalSupply}`);

            return {
                ...bundle,
                holdingAmount: totalHoldingNumber,
                holdingPercentage: (totalHoldingNumber / totalSupply) * 100
            };
        }));

        const totalHoldingAmount = allBundles.reduce((sum, bundle) => sum + bundle.holdingAmount, 0);
        const totalHoldingAmountPercentage = (totalHoldingAmount / totalSupply) * 100;

        return {
            totalBundles: filteredBundles.length,
            totalTokensBundled,
            percentageBundled,
            totalSolSpent,
            totalHoldingAmount,
            totalHoldingAmountPercentage,
            allBundles,
            tokenInfo,
            isTeamAnalysis
        };
    }
}


async function isTeamWallet(address, funderAddress) {
    const solanaApi = getSolanaApi();

    // Vérification si c'est un fresh wallet
    if (await isFreshWallet(address, 'bundle', 'teamAnalysis')) {
        logger.debug(`${address} is a fresh wallet, considered as team wallet`);
        return true;
    }

    // Le funderAddress est déjà fourni, pas besoin de le récupérer à nouveau
    if (funderAddress) {
        logger.debug(`${address} has funder ${funderAddress}`);
        // Notez que nous ne considérons pas automatiquement cela comme un critère d'équipe
        // La logique pour les funders communs est gérée dans analyzeBundle
    }

    logger.debug(`${address} is not considered as a team wallet`);
    return false;
}

async function isFreshWallet(address, mainContext, subContext) {
    try {
        const solanaApi = getSolanaApi();
        const signatures = await solanaApi.getSignaturesForAddress(address, { limit: FRESH_WALLET_THRESHOLD + 1 }, mainContext, subContext);
        return signatures.length <= FRESH_WALLET_THRESHOLD;
    } catch (error) {
        logger.error(`Error checking if ${address} is a fresh wallet:`, error);
        return false;
    }
}

async function calculateTeamHoldings(teamWallets, tokenAddress, tokenDecimals) {
    const solanaApi = getSolanaApi();
    let totalHoldingAmount = 0;

    for (const wallet of teamWallets) {
        const tokenAccounts = await solanaApi.getTokenAccountsByOwner(wallet, tokenAddress);
        for (const account of tokenAccounts) {
            const balance = await solanaApi.getTokenAccountBalance(account.pubkey, { commitment: 'confirmed' });
            if (balance && balance.amount) {
                totalHoldingAmount += Number(balance.amount) / Math.pow(10, tokenDecimals);
            }
        }
    }

    return { totalHoldingAmount };
}

module.exports = analyzeBundle;