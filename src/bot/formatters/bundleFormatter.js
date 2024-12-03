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

    output += "⚠️Bundles shown for pump.fun coins aren't necessarily block 0 bundles. For more information on how the /bundle command works please use /help /bundle in private.";

    return output;
}


function formatNonPumpfunBundleResponse(bundleData, tokenInfo) {
    let output = `<b>Bundle Analysis</b> for <a href="https://solscan.io/token/${tokenInfo.address}">${tokenInfo.name}</a> (${tokenInfo.symbol}) <a href="https://dexscreener.com/solana/${tokenInfo.address}">📈</a>\n\n`;

    output += `<b>📦 Bundle Detected:</b> ${bundleData.bundleDetected ? 'Yes' : 'No'}\n`;
    output += `<b>🔢 Total Bundles:</b> ${bundleData.bundles.length}\n`;
    output += `<b>🪙 Total Tokens Bundled:</b> ${formatNumber(bundleData.totalTokenAmount, 2)} ${tokenInfo.symbol} (${formatNumber(bundleData.developerInfo.percentageOfSupply, 2)}%)\n`;
    output += `<b>💰 Total SOL Spent:</b> ${formatNumber(bundleData.totalSolAmount, 2)} SOL\n\n`;

    output += "<b>Top 5 Transactions:</b>\n";
    const transactions = Object.entries(bundleData.transactionDetails)
        .sort(([, a], [, b]) => b.tokenAmounts[0] - a.tokenAmounts[0])
        .slice(0, 5);

    transactions.forEach(([txHash, details], index) => {
        const truncatedHash = truncateAddress(txHash);
        output += `<b>Transaction ${index + 1}:</b> <a href="https://solscan.io/tx/${txHash}">${truncatedHash}</a>\n`;
        output += `  <b>🪙 Token Amount:</b> ${formatNumber(details.tokenAmounts[0], 2)} ${tokenInfo.symbol}\n`;
        output += `  <b>💰 SOL Amount:</b> ${formatNumber(details.solAmounts[0], 2)} SOL\n`;
        output += `  <b>📊 Percentage:</b> ${formatNumber(details.tokenAmountsPercentages[0], 2)}%\n\n`;
    });

    return output;
}


module.exports = {
    formatMainMessage,
    formatNonPumpfunBundleResponse
};