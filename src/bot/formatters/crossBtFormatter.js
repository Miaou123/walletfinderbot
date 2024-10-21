const { formatNumber, getEmojiForPnl, truncateAddress } = require('./generalFormatters');
const logger = require('../../utils/logger');

function formatCrossBtResponse(analysisResults, tokenAddresses) {
    logger.info('Formatting CrossBt response');
    logger.debug(`Analysis results: ${JSON.stringify(analysisResults)}`);
    logger.debug(`Token addresses: ${JSON.stringify(tokenAddresses)}`);

    let message = '<b>Cross-Analysis of Top Traders</b>\n\n';

    message += `Analyzing top traders for ${tokenAddresses.length} tokens:\n`;
    tokenAddresses.forEach((address, index) => {
        message += `${index + 1}. <code>${truncateAddress(address)}</code>\n`;
    });
    message += '\n';

    message += `<b>Common traders across all tokens:</b> ${analysisResults.commonTraders.length}\n\n`;

    analysisResults.commonTraders.forEach((trader, index) => {
        try {
            logger.debug(`Formatting trader info for trader ${index + 1}: ${JSON.stringify(trader)}`);
            message += formatTraderInfo(trader, index + 1, tokenAddresses);
        } catch (error) {
            logger.error(`Error formatting trader info: ${error.message}`, { trader });
            message += `Error formatting trader ${index + 1}\n\n`;
        }
    });

    logger.info('CrossBt response formatted successfully');
    return message;
}

function formatTraderInfo(trader, rank, tokenAddresses) {
    if (!trader || !trader.address) {
        logger.warn('Invalid trader data', { trader });
        return `${rank}. Invalid trader data\n\n`;
    }

    const shortAddress = truncateAddress(trader.address);
    const pnlEmoji = trader.isBot ? '🤖' : getEmojiForPnl(trader.walletCheckerData?.total_value || 0);

    let result = `${rank}. <a href="https://solscan.io/account/${trader.address}">${shortAddress}</a> ${pnlEmoji} <a href="https://gmgn.ai/sol/address/${trader.address}">GMGN</a>/<a href="https://app.cielo.finance/profile/${trader.address}/pnl/tokens">Cielo</a>\n`;

    if (trader.walletCheckerData) {
        const { total_value, sol_balance, realized_profit_30d, unrealized_profit, winrate } = trader.walletCheckerData;
        result += `├ 💼 Port: $${formatNumber(total_value || 0, 0)} (SOL: ${formatNumber(sol_balance || 0, 2)})\n`;
        result += `├ 💰 P/L (30d): $${formatNumber(realized_profit_30d || 0, 0)} 📈 uP/L: $${formatNumber(unrealized_profit || 0, 0)}\n`;
        result += `├ 📊 Winrate (30d): ${((winrate || 0) * 100).toFixed(2)}%\n`;
    }

    result += '└ 🏆 Stats:\n';
    if (Array.isArray(trader.traderInfo)) {
        trader.traderInfo.forEach((info, index) => {
            if (info && tokenAddresses[index]) {
                const shortTokenAddress = truncateAddress(tokenAddresses[index]);
                result += `   ${shortTokenAddress}: PNL $${formatNumber(info.pnl || 0)}, ${info.pnlPercentage}%\n`;
            }
        });
    } else {
        result += '   No stats information available\n';
    }

    logger.debug(`Formatted trader info: ${result}`);
    return result + '\n';
}

module.exports = {
    formatCrossBtResponse
};