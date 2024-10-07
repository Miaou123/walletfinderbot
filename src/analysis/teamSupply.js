const { getSolanaApi } = require('../integrations/solanaApi');
const dexScreenerApi = require('../integrations/dexScreenerApi');
const { checkInactivityPeriod } = require('../tools/inactivityPeriod');
const { formatNumber } = require('../bot/formatters/generalFormatters');
const { getHolders } = require('../tools/getHolders');

const BigNumber = require('bignumber.js');

const FRESH_WALLET_THRESHOLD = 100;
const TRANSACTION_CHECK_LIMIT = 20;
const MAX_ASSETS_THRESHOLD = 2;

BigNumber.config({ DECIMAL_PLACES: 18, ROUNDING_MODE: BigNumber.ROUND_DOWN });

function filterSignificantHolders(allHolders, totalSupply) {
    const SUPPLY_THRESHOLD = new BigNumber('0.001'); // 0.1%
    const significantHolders = allHolders.filter(holder => {
        const balance = new BigNumber(holder.balance);
        const percentage = balance.dividedBy(totalSupply);
        return percentage.isGreaterThanOrEqualTo(SUPPLY_THRESHOLD);
    });
    console.log(`Total holders: ${allHolders.length}, Significant holders: ${significantHolders.length}`);
    return significantHolders;
}

async function analyzeTeamSupply(tokenAddress, mainContext = 'default') {

    try {
        const tokenInfo = await dexScreenerApi.getTokenInfo(tokenAddress, mainContext);
        const totalSupply = new BigNumber(tokenInfo.totalSupply);

        const allHolders = await getHolders(tokenAddress, mainContext, 'getHolders');

        const significantHolders = filterSignificantHolders(allHolders, totalSupply, tokenInfo);
        const analyzedWallets = await analyzeWallets(significantHolders, tokenAddress, mainContext);
        console.log(`Analyzed wallets: ${analyzedWallets.length}`);

        const { message, allWalletsDetails } = formatResults(analyzedWallets, tokenInfo);

        const allTeamWallets = analyzedWallets
            .filter(w => w.category !== 'Unknown')
            .map(w => w.address);

        return { 
            formattedResults: message,
            allWalletsDetails, 
            allTeamWallets,
            tokenInfo, 
            tokenAddress,
        };
    } catch (error) {
        console.error('Error in analyzeTeamSupply:', error);
        throw error;
    }
}

async function analyzeWallets(wallets, tokenAddress, mainContext) {
    console.log(`Analyzing ${wallets.length} wallets...`);
    const analyzeWallet = async (wallet) => {
        let category = 'Unknown';
        let daysSinceLastActivity = null;

        const isFresh = await isFreshWallet(wallet.address, mainContext, 'isFreshWallet');
        if (isFresh) {
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
            } else {
                const isTeambot = await checkIfTeambot(wallet.address, tokenAddress);
                if (isTeambot) {
                    category = 'Teambot';
                }
            }
        }

        console.log(`Wallet ${wallet.address.slice(0, 6)}... category: ${category}`);
        return {
            ...wallet,
            category,
            daysSinceLastActivity
        };
    };
    // Analyze wallets in batches
    const batchSize = 10;
    const analyzedWallets = [];
    for (let i = 0; i < wallets.length; i += batchSize) {
        const batch = wallets.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(analyzeWallet));
        analyzedWallets.push(...batchResults);
    }

    return analyzedWallets;
}

async function checkIfTeambot(address, tokenAddress, mainContext = 'default') {
    const solanaApi = getSolanaApi();
    try {
        const assetCount = await solanaApi.getAssetCount(address, mainContext, 'checkIfTeambot');
        if (assetCount <= MAX_ASSETS_THRESHOLD) {
            const recentTransactions = await getRecentTransactions(address, TRANSACTION_CHECK_LIMIT, mainContext);
            const allTransactionsInvolveToken = recentTransactions.every(tx => {
                if (tx && tx.meta && Array.isArray(tx.meta.postTokenBalances)) {
                    return tx.meta.postTokenBalances.some(balance => balance.mint === tokenAddress);
                }
                return false;
            });
            return allTransactionsInvolveToken;
        }
        return false;
    } catch (error) {
        console.error(`Error checking if ${address} is a teambot:`, error.message);
        return false;
    }
}

async function getRecentTransactions(address, limit, mainContext) {
    const solanaApi = getSolanaApi();
    try {
        const signatures = await solanaApi.getSignaturesForAddress(address, { limit }, mainContext, 'getRecentTransactions');
        const transactions = await Promise.all(
            signatures.map(async (sig) => {
                try {
                    const options = { 
                        encoding: 'jsonParsed',
                        maxSupportedTransactionVersion: 0
                    };
                    return await solanaApi.getTransaction(sig.signature, options, mainContext, 'getTransaction');
                } catch (error) {
                    console.warn(`Failed to fetch transaction for signature ${sig.signature}:`, error.message);
                    return null;
                }
            })
        );
        return transactions.filter(tx => tx !== null);
    } catch (error) {
        console.error(`Error fetching recent transactions for ${address}:`, error);
        return [];
    }
}

async function isFreshWallet(address, mainContext, subContext) {
    try {
        const solanaApi = getSolanaApi();
        const signatures = await solanaApi.getSignaturesForAddress(address, { limit: FRESH_WALLET_THRESHOLD + 1 }, mainContext, subContext);
        return signatures.length <= FRESH_WALLET_THRESHOLD;
    } catch (error) {
        console.error(`Error checking if ${address} is a fresh wallet:`, error);
        return false;
    }
}

function formatResults(analyzedWallets, tokenInfo) {
    let message = `<b>Team Supply Analysis for ${tokenInfo.symbol}</b>\n\n`;

    let teamSupplyHeld = new BigNumber(0);
    let teamWallets = 0;

    const teamWalletList = analyzedWallets.filter(w => w.category !== 'Unknown').map(w => ({
        address: w.address,
        balance: new BigNumber(w.balance),
        category: w.category
    }));

    teamWalletList.forEach(w => {
        teamSupplyHeld = teamSupplyHeld.plus(w.balance);
        teamWallets++;
    });

    const teamSupplyPercentage = teamSupplyHeld.dividedBy(tokenInfo.totalSupply).multipliedBy(100).toFixed(2);
    const teamValueUsd = teamSupplyHeld.multipliedBy(tokenInfo.priceUsd);
    
    const getEmoji = (percentage) => {
        if (percentage <= 10) return '🟢';
        if (percentage <= 20) return '🟡';
        if (percentage <= 40) return '🟠';
        if (percentage <= 50) return '🔴';
        return '☠️';
    };

    message += `👥 Supply Controlled by team/insiders: ${teamSupplyPercentage}% ($${formatNumber(teamValueUsd)}) ${getEmoji(parseFloat(teamSupplyPercentage))}\n`;
    message += `⚠️ Wallets flagged as team/insiders: ${teamWallets}\n\n`;

    message += `<b>Top team wallets:</b>\n`;
    const topTeamWallets = teamWalletList
        .sort((a, b) => b.balance.minus(a.balance).toNumber())
        .slice(0, 10);

    topTeamWallets.forEach((wallet, index) => {
        const supplyPercentage = wallet.balance.dividedBy(tokenInfo.totalSupply).multipliedBy(100).toFixed(2);
        message += `${index + 1}. ${formatAddress(wallet.address)} (${supplyPercentage}% of supply) - ${wallet.category}\n`;
    });

    return { message, allWalletsDetails: teamWalletList };
}

const sendWalletDetails = async (bot, chatId, allWalletsDetails, tokenInfo) => {
    const teamWallets = allWalletsDetails.sort((a, b) => b.balance.minus(a.balance).toNumber());

    let message = `<b><a href="https://dexscreener.com/solana/${tokenInfo.address}">${tokenInfo.symbol}</a></b>\n\n`;
    message += `<strong>${teamWallets.length} team addresses:</strong>\n\n`;

    const formatAddress = (address) => `<a href="https://solscan.io/account/${address}">${address.slice(0, 6)}...${address.slice(-4)}</a>`;

    const calculateSupplyPercentage = (balance) => {
        return new BigNumber(balance).dividedBy(tokenInfo.totalSupply).multipliedBy(100).toFixed(2);
    };

    teamWallets.forEach((wallet, index) => {
        const supplyPercentage = calculateSupplyPercentage(wallet.balance);
        message += `${index + 1}. ${formatAddress(wallet.address)} (${supplyPercentage}% of supply) - ${wallet.category}\n`;
    });

    await bot.sendLongMessage(chatId, message, { parse_mode: 'HTML', disable_web_page_preview: true });
};

function formatAddress(address) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

module.exports = { analyzeTeamSupply, sendWalletDetails };