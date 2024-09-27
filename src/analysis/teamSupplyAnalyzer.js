const { getSolanaApi } = require('../integrations/solanaApi');
const { getDexScreenerApi } = require('../integrations/dexscreenerApi');
const { checkInactivityPeriod } = require('../tools/inactivityPeriod');
const { formatNumber } = require('../bot/formatters/generalFormatters');
const { analyzeFunding } = require('../tools/fundingAnalyzer');
const { getHolders, getTopHolders } = require('../tools/getHolders');

const BigNumber = require('bignumber.js');

const MAX_ASSETS = 2;
const FRESH_WALLET_THRESHOLD = 100;

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
    const dexScreenerApi = getDexScreenerApi();

    try {
        const tokenInfo = await dexScreenerApi.getTokenInfo(tokenAddress, mainContext);
        const totalSupply = new BigNumber(tokenInfo.totalSupply);

        const allHolders = await getHolders(tokenAddress, mainContext, 'getHolders');

        const significantHolders = filterSignificantHolders(allHolders, totalSupply, tokenInfo);
        const analyzedWallets = await analyzeWallets(significantHolders, tokenAddress, mainContext);
        console.log(`Analyzed wallets: ${analyzedWallets.length}`);


        // Analyse de funding sur les wallets non détectés comme "team"
        const nonTeamWallets = analyzedWallets.filter(w => w.category === 'Unknown');
        const { groupedWallets: fundingGroups } = await analyzeFunding(nonTeamWallets, mainContext, 'analyzeFunding')

        const { message, allWalletsDetails } = formatResults(analyzedWallets, fundingGroups, tokenInfo);

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
        let assetCount = null;
        let daysSinceLastActivity = null;

        const isFresh = await isFreshWallet(wallet.address, mainContext, 'isFreshWallet');
        if (isFresh) {
            category = 'Fresh';
        } else {
            assetCount = await getAssetCount(wallet.address, mainContext, 'getAssetCount');
            if (assetCount <= MAX_ASSETS) {
                category = 'Few Assets';
            } else {
                const inactivityCheck = await checkInactivityPeriod(wallet.address, tokenAddress, mainContext, 'checkInactivity');
                if (inactivityCheck.category === 'No Token') {
                    category = 'No Token';
                } else if (inactivityCheck.category === 'No ATA Transaction') {
                    category = 'No ATA Transaction';
                } else if (inactivityCheck.isInactive) {
                    category = 'Inactive';
                    daysSinceLastActivity = inactivityCheck.daysSinceLastActivity;
                }
            }
        }

        console.log(`Wallet ${wallet.address.slice(0, 6)}... category: ${category}`);
        return {
            ...wallet,
            category,
            assetCount,
            daysSinceLastActivity
        };
    };
    // Analyze wallets in batches to avoid overwhelming the system
    const batchSize = 5;
    const analyzedWallets = [];
    for (let i = 0; i < wallets.length; i += batchSize) {
        const batch = wallets.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(analyzeWallet));
        analyzedWallets.push(...batchResults);
    }

    return analyzedWallets;
}

// Ajoutez cette nouvelle fonction
async function getAssetCount(address, mainContext, subContext) {
    try {
        const solanaApi = getSolanaApi();
        let page = 1;
        let totalAssets = 0;
        let hasMore = true;

        while (hasMore) {
            const result = await solanaApi.getAssetsByOwner(address, page, 1000, true, mainContext, subContext);
            if (result && result.items) {
                totalAssets += result.items.length;
                hasMore = result.items.length === 1000;
                page++;
            } else {
                hasMore = false;
            }

            if (totalAssets > MAX_ASSETS) {
                break;
            }
        }

        return totalAssets;
    } catch (error) {
        console.error(`Error getting asset count for ${address}:`, error.message);
        return 0;
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

function formatResults(analyzedWallets, fundingGroups, tokenInfo) {
    let message = `<b>Team Supply Analysis for ${tokenInfo.symbol}</b>\n\n`;

    let teamSupplyHeld = new BigNumber(0);
    let freshTotal = new BigNumber(0);
    let fewAssetsTotal = new BigNumber(0);
    let inactiveTotal = new BigNumber(0);
    let suspiciousFundingTotal = new BigNumber(0);

    let freshWallets = 0;
    let fewAssetsWallets = 0;
    let inactiveWallets = 0;
    let suspiciousFundingWallets = 0;

    analyzedWallets.forEach(w => {
        const balance = new BigNumber(w.balance);
        
        if (w.category === 'Fresh') {
            freshTotal = freshTotal.plus(balance);
            teamSupplyHeld = teamSupplyHeld.plus(balance);
            freshWallets++;
        } else if (w.category === 'Few Assets') {
            fewAssetsTotal = fewAssetsTotal.plus(balance);
            teamSupplyHeld = teamSupplyHeld.plus(balance);
            fewAssetsWallets++;
        } else if (w.category === 'Inactive') {
            inactiveTotal = inactiveTotal.plus(balance);
            teamSupplyHeld = teamSupplyHeld.plus(balance);
            inactiveWallets++;
        }
    });

    fundingGroups.forEach(([_, wallets]) => {
        wallets.forEach(w => {
            const balance = new BigNumber(w.balance);
            suspiciousFundingTotal = suspiciousFundingTotal.plus(balance);
            teamSupplyHeld = teamSupplyHeld.plus(balance);
            suspiciousFundingWallets++;
        });
    });

    const totalTeamWallets = freshWallets + fewAssetsWallets + inactiveWallets + suspiciousFundingWallets;

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
    message += `⚠️ Wallets flagged as team/insiders: ${totalTeamWallets}\n\n`;

    message += `<b>Breakdown:</b>\n`;
    message += `🆕 Fresh wallets: ${freshWallets} (${freshTotal.dividedBy(tokenInfo.totalSupply).multipliedBy(100).toFixed(2)}%)\n`;
    message += `💤 Inactive wallets: ${inactiveWallets} (${inactiveTotal.dividedBy(tokenInfo.totalSupply).multipliedBy(100).toFixed(2)}%)\n`;
    message += `🔗 Suspicious funding: ${suspiciousFundingWallets} (${suspiciousFundingTotal.dividedBy(tokenInfo.totalSupply).multipliedBy(100).toFixed(2)}%)\n`;
    message += `💼 Suspicious activity: ${fewAssetsWallets} (${fewAssetsTotal.dividedBy(tokenInfo.totalSupply).multipliedBy(100).toFixed(2)}%)\n`;

    const allWalletsDetails = [
        ...analyzedWallets.map(w => ({
            address: w.address,
            balance: w.balance,
            category: w.category,
            assetCount: w.assetCount,
            daysSinceLastActivity: w.daysSinceLastActivity
        })),
        ...fundingGroups.flatMap(([funder, wallets]) => 
            wallets.map(w => ({
                address: w.address,
                balance: w.balance,
                category: 'Suspicious Funding',
                funder: funder
            }))
        )
    ];

    return { message, allWalletsDetails };
}

const sendWalletDetails = async (bot, chatId, allWalletsDetails, tokenInfo) => {
    const freshWallets = allWalletsDetails.filter(w => w.category === 'Fresh');
    const fewAssetsWallets = allWalletsDetails.filter(w => w.category === 'Few Assets');
    const inactiveWallets = allWalletsDetails.filter(w => w.category === 'Inactive');
    const suspiciousFundingWallets = allWalletsDetails.filter(w => w.category === 'Suspicious Funding');

    const totalTeamWallets = freshWallets.length + fewAssetsWallets.length + 
    inactiveWallets.length + suspiciousFundingWallets.length;

    let message = `<b><a href="https://dexscreener.com/solana/${tokenInfo.address}">${tokenInfo.symbol}</a></b>\n\n`;
    message += `<strong>${totalTeamWallets} potential team addresses:</strong>\n\n`;

    const formatAddress = (address) => `<a href="https://solscan.io/account/${address}">${address.slice(0, 6)}...${address.slice(-4)}</a>`;

    const calculateSupplyPercentage = (balance) => {
        return new BigNumber(balance).dividedBy(tokenInfo.totalSupply).multipliedBy(100).toFixed(2);
    };

    if (freshWallets.length > 0) {
        message += `<b>🆕 Fresh wallets: ${freshWallets.length}</b>\n`;
        freshWallets.forEach(wallet => {
            const supplyPercentage = calculateSupplyPercentage(wallet.balance);
            message += `${formatAddress(wallet.address)} (${supplyPercentage}% of supply)\n`;
        });
        message += '\n';
    }

    if (fewAssetsWallets.length > 0) {
        message += `<b>💼 Few Assets wallets: ${fewAssetsWallets.length}</b>\n`;
        fewAssetsWallets.forEach(wallet => {
            const supplyPercentage = calculateSupplyPercentage(wallet.balance);
            message += `${formatAddress(wallet.address)} (${wallet.assetCount} assets, ${supplyPercentage}% of supply)\n`;
        });
        message += '\n';
    }

    if (inactiveWallets.length > 0) {
        message += `<b>💤 Inactive wallets: ${inactiveWallets.length}</b>\n`;
        inactiveWallets.forEach(wallet => {
            const supplyPercentage = calculateSupplyPercentage(wallet.balance);
            message += `${formatAddress(wallet.address)} (${wallet.daysSinceLastActivity.toFixed(2)} days, ${supplyPercentage}% of supply)\n`;
        });
        message += '\n';
    }

    if (suspiciousFundingWallets.length > 0) {
        message += `<b>🔗 Suspicious funding: ${suspiciousFundingWallets.length}</b>\n`;
        
        // Group wallets by funder
        const funderGroups = {};
        suspiciousFundingWallets.forEach(wallet => {
            if (!funderGroups[wallet.funder]) {
                funderGroups[wallet.funder] = [];
            }
            funderGroups[wallet.funder].push(wallet);
        });

        // Display wallets grouped by funder
        Object.entries(funderGroups).forEach(([funder, wallets]) => {
            message += `\nFunded by ${formatAddress(funder)}:\n`;
            wallets.forEach(wallet => {
                const supplyPercentage = calculateSupplyPercentage(wallet.balance);
                message += `  ${formatAddress(wallet.address)} (${supplyPercentage}% of supply)\n`;
            });
        });
        message += '\n';
    }

    await bot.sendLongMessage(chatId, message, { parse_mode: 'HTML', disable_web_page_preview: true });
};

module.exports = { analyzeTeamSupply, sendWalletDetails };