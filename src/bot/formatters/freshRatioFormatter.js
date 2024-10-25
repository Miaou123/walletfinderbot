const { formatNumber, truncateAddress } = require('./generalFormatters');
const logger = require('../../utils/logger');


const formatFreshRatioMessage = (result, tokenInfo) => {
    try {
        let message = `<b>Fresh wallet ratio analysis results for</b>\n`;
        message += `<b><a href="https://solscan.io/token/${tokenInfo.address}">${tokenInfo.name}</a></b> (${tokenInfo.symbol}) `;
        message += `<a href="https://dexscreener.com/solana/${tokenInfo.address}">📈</a>\n`;
        message += `<code>${tokenInfo.address}</code>\n\n`;

        message += `📊 <b>Analysis Results:</b>\n`;
        message += `└ Fresh Wallets Ratio: ${formatNumber(result.freshWalletsRatio, 2, true)}\n\n`;

        if (result.wallets.filter(w => w.isFresh).length > 0) {
            const freshWallets = result.wallets
                .filter(w => w.isFresh)
                .sort((a, b) => b.firstBuyAmount - a.firstBuyAmount)
                .slice(0, 10);

            message += `🔝 <b>Top Fresh Wallet Buyers:</b>\n`;
            freshWallets.forEach((wallet, index) => {

                const buyAmountNumber = Number(wallet.firstBuyAmount);
                const supplyPercent = (buyAmountNumber / tokenInfo.total_supply) * 100;
                
                const truncatedAddr = truncateAddress(wallet.address);
                message += `${index + 1}. <a href="https://solscan.io/account/${wallet.address}">${truncatedAddr}</a> - ${formatNumber(supplyPercent, 3, true)}\n`;
            });
        }

        return message;

    } catch (error) {
        logger.error('Error formatting fresh ratio message:', error);
        return 'Error formatting analysis results.';
    }
};


module.exports = {
    formatFreshRatioMessage
};