const { formatNumber, truncateAddress, getEmojiForPnl } = require('./generalFormatters');

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

    const analysisType = isTeamAnalysis ? "Team" : "Total";

    let output = `<b>${analysisType} ${isTeamAnalysis ? 'Analysis' : 'Bundles'}</b> for <a href="https://solscan.io/token/${tokenInfo.address}">${tokenInfo.name}</a> (${tokenInfo.symbol}) <a href="https://dexscreener.com/solana/${tokenInfo.address}">📈</a>\n\n`;
    
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
            output += `  <b>🪙 Tokens Bought:</b> ${formatNumber(bundle.tokensBought)} ${tokenInfo.symbol} (${formatNumber((bundle.tokensBought / tokenInfo.totalSupply) * 100, 2, true)})\n`;
            output += `  <b>💰 SOL Spent:</b> ${formatNumber(bundle.solSpent)} SOL\n`;
            if (bundle.holdingAmount !== undefined) {
                output += `  <b>🔒 Holding Amount:</b> ${formatNumber(bundle.holdingAmount)} ${tokenInfo.symbol} (${formatNumber(bundle.holdingPercentage, 2, true)})\n`;
            }
            output += '\n';
        });
    } else {
        output += "No bundles to display.\n";
    }

    return output;
}

module.exports = formatMainMessage;