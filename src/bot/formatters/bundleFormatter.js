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
        totalTeamWallets
    } = results;

    logger.debug(`\n=== FORMATTER DEBUG ===`);
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

    // Add Pumpfun notice at the top
    let output = `<b>💊 Pumpfun Bundle Analysis</b>\n`;
    output += `<i>⚠️ This analysis only works for Pumpfun tokens</i>\n\n`;
    
    output += `<b>${analysisType} ${isTeamAnalysis ? 'Analysis' : 'Bundles'}</b> for <a href="https://solscan.io/token/${tokenInfo.address}">${tokenInfo.name}</a> (${tokenInfo.symbol}) <a href="https://dexscreener.com/solana/${tokenInfo.address}">📈</a>\n\n`;
    
    if (isTeamAnalysis) {
        output += `<b>👥 Total Team Bundles:</b> ${totalTeamWallets}\n`;
    } else {
        output += `<b>📦 Total Bundles:</b> ${totalBundles}\n`;
    }
    
    output += `<b>🪙 ${analysisType} Tokens Bundled:</b> ${formatNumber(totalTokensBundled)} ${tokenInfo.symbol} (${formatNumber(percentageBundled, 2, true)})\n`;
    output += `<b>💰 Total SOL Spent:</b> ${formatNumber(totalSolSpent)} SOL\n`;
    output += `<b>🔒 ${analysisType} Holding Amount:</b> ${formatNumber(totalHoldingAmount)} ${tokenInfo.symbol} (${formatNumber(totalHoldingAmountPercentage, 2, true)})\n\n`;

    output += `<b>Top 5 ${isTeamAnalysis ? 'team bundles' : 'bundles'}:</b>\n`;
    const bundlesToDisplay = isTeamAnalysis ? teamBundles : allBundles;
    
    if (bundlesToDisplay && bundlesToDisplay.length > 0) {
        bundlesToDisplay.slice(0, 5).forEach((bundle, index) => {
            const walletLinks = Array.from(bundle.uniqueWallets).map(wallet => {
                const truncated = truncateAddress(wallet);
                return `<a href="https://solscan.io/address/${wallet}">${truncated}</a>`;
            }).join(', ');

            output += `<b>${isTeamAnalysis ? 'Buy' : 'Bundle'} ${index + 1} (Slot ${bundle.slot}):</b>\n`;
            output += `  <b>💼 Wallets:</b> ${walletLinks}\n`;
            output += `  <b>🪙 Tokens Bought:</b> ${formatNumber(bundle.tokensBought)} ${tokenInfo.symbol} (${formatNumber((bundle.tokensBought / tokenInfo.total_supply) * 100, 2, true)})\n`;
            output += `  <b>💰 SOL Spent:</b> ${formatNumber(bundle.solSpent)} SOL\n`;
            if (bundle.holdingAmount !== undefined) {
                output += `  <b>🔒 Holding Amount:</b> ${formatNumber(bundle.holdingAmount)} ${tokenInfo.symbol} (${formatNumber(bundle.holdingPercentage, 2, true)})\n`;
            }
            output += '\n';
        });
    } else {
        output += "No bundles to display.\n";
    }

    output += "⚠️ Bundles shown aren't necessarily block 0 bundles. For more information on how the /bundle command works please use /help bundle in private.";

    return output;
}

module.exports = {
    formatMainMessage
};