const { formatNumber, truncateAddress } = require('./generalFormatters');
const logger = require('../../utils/logger');

function formatMainMessage(results) {
    const {
        totalBundles,
        totalTokensBundled,
        percentageBundled,
        totalSolSpent,
        totalHoldingAmount,
        totalHoldingAmountPercentage,
        allBundles,
        teamBundles,
        tokenInfo,
        isTeamAnalysis,
        totalTeamWallets,
        platform
    } = results;

    logger.debug(`\n=== FORMATTER DEBUG ===`);
    logger.debug(`Platform: ${platform}`);
    logger.debug(`Total holding amount received: ${totalHoldingAmount}`);
    logger.debug(`Total holding percentage: ${totalHoldingAmountPercentage}%`);
    logger.debug(`Number of bundles to format: ${allBundles?.length || 0}`);
    
    if (allBundles && allBundles.length > 0) {
        logger.debug(`\n=== TOP 10 BUNDLES RECEIVED BY FORMATTER ===`);
        allBundles.slice(0, 10).forEach((bundle, index) => {
            logger.debug(`${index + 1}. Slot ${bundle.slot}:`);
            logger.debug(`   Tokens bought: ${bundle.tokensBought}`);
            logger.debug(`   Holding amount: ${bundle.holdingAmount || 'undefined'}`);
            logger.debug(`   Holding percentage: ${bundle.holdingPercentage || 'undefined'}%`);
            logger.debug(`   Wallets: ${Array.from(bundle.uniqueWallets || []).length}`);
        });
        
        const bundlesWithHoldings = allBundles.filter(b => (b.holdingAmount || 0) > 0);
        logger.debug(`\n=== BUNDLES WITH NON-ZERO HOLDINGS ===`);
        logger.debug(`Found ${bundlesWithHoldings.length} bundles with holdings`);
        bundlesWithHoldings.forEach((bundle, index) => {
            logger.debug(`${index + 1}. Slot ${bundle.slot}: ${bundle.holdingAmount} (${bundle.holdingPercentage?.toFixed(4)}%)`);
        });
    }

    const analysisType = isTeamAnalysis ? "Team" : "Total";
    const platformDisplay = platform || 'Unknown';

    // Platform-specific header with emojis
    let platformEmoji = '💊'; // Default
    let platformName = platformDisplay;
    
    if (platform === 'PumpFun') {
        platformEmoji = '💊';
        platformName = 'PumpFun';
    } else if (platform === 'Bonk.fun') {
        platformEmoji = '🐶';
        platformName = 'Bonk.fun';
    }

    let output = `<b>${platformEmoji} ${platformName} Bundle Analysis</b>\n`;
    output += `<i>⚠️ This analysis works for ${platformName} tokens</i>\n\n`;
    
    output += `<b>${analysisType} ${isTeamAnalysis ? 'Analysis' : 'Bundles'}</b> for <a href="https://solscan.io/token/${tokenInfo.address}">${tokenInfo.name}</a> (${tokenInfo.symbol}) <a href="https://dexscreener.com/solana/${tokenInfo.address}">📈</a>\n\n`;
    
    if (isTeamAnalysis) {
        output += `<b>👥 Total Team Bundles:</b> ${totalTeamWallets}\n`;
    } else {
        output += `<b>📦 Total Bundles:</b> ${totalBundles}\n`;
    }
    
    output += `<b>🪙 ${analysisType} Tokens Bundled:</b> ${formatNumber(totalTokensBundled)} ${tokenInfo.symbol} (${formatNumber(percentageBundled, 2, true)})\n`;
    output += `<b>💰 Total SOL Spent:</b> ${formatNumber(totalSolSpent)} SOL\n`;
    output += `<b>🔒 ${analysisType} Holding Amount:</b> ${formatNumber(totalHoldingAmount)} ${tokenInfo.symbol} (${formatNumber(totalHoldingAmountPercentage, 2, true)})\n\n`;

    output += `<b>Top 5 ${isTeamAnalysis ? 'team bundles' : 'bundles'}:</b>\n\n`;

    const bundlesToShow = isTeamAnalysis ? teamBundles : allBundles;
    
    if (!bundlesToShow || bundlesToShow.length === 0) {
        output += `No bundles to display.\n\n`;
    } else {
        bundlesToShow.slice(0, 5).forEach((bundle, index) => {
            const walletLinks = Array.from(bundle.uniqueWallets).slice(0, 5).map(wallet => {
                const truncated = truncateAddress(wallet);
                return `<a href="https://solscan.io/account/${wallet}">${truncated}</a>`;
            }).join(', ');

            const moreWallets = bundle.uniqueWallets.size > 5 ? ` (+${bundle.uniqueWallets.size - 5} more)` : '';

            output += `<b>Bundle ${index + 1} (Slot ${bundle.slot}):</b>\n`;
            output += `  <b>💼 Wallets:</b> ${walletLinks}${moreWallets}\n`;
            output += `  <b>🪙 Tokens Bought:</b> <code>${formatNumber(bundle.tokensBought)}</code> ${tokenInfo.symbol} (<code>${formatNumber((bundle.tokensBought / tokenInfo.total_supply) * 100, 2, true)}</code>)\n`;
            output += `  <b>💰 SOL Spent:</b> <code>${formatNumber(bundle.solSpent)}</code> SOL\n`;
            
            if (bundle.holdingAmount !== undefined) {
                const holdingPercentage = bundle.holdingPercentage || ((bundle.holdingAmount / tokenInfo.total_supply) * 100);
                output += `  <b>🔒 Holding Amount:</b> <code>${formatNumber(bundle.holdingAmount)}</code> ${tokenInfo.symbol} (<code>${formatNumber(holdingPercentage, 2, true)}</code>)\n`;
            }
            
            output += `\n`;
        });
    }

    output += `⚠️Bundles aren't necessarily block 0 and may occur at any time. For more information on how the /bundle command works please use /help /bundle in private.`;

    return output;
}

module.exports = {
    formatMainMessage
};