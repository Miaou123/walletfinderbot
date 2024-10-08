const { formatNumber, getEmojiForPnl } = require('./generalFormatters');
const logger = require('../../utils/logger');

const sendFormattedCrossAnalysisMessage = async (bot, chatId, filteredHolders, contractAddresses, tokenInfos) => {
    try {
        if (!Array.isArray(filteredHolders) || filteredHolders.length === 0) {
            logger.warn('No filtered holders to format');
            await bot.sendLongMessage(chatId, 'No common holders found matching the criteria.');
            return;
        }

        let message = `<b>Cross-Analysis Results</b>\n\n`;
        message += `Analyzed tokens:\n${tokenInfos.map(t => `${t.symbol} (${t.address})`).join('\n')}\n\n`;
        message += `Total common holders: ${filteredHolders.length}\n\n`;

        const walletMessages = filteredHolders.map((wallet, index) => 
            formatCrossAnalysisWallet(wallet, contractAddresses, tokenInfos, index + 1)
        );

        const validMessages = walletMessages.filter(msg => msg !== '');
        message += validMessages.join('\n');

        await bot.sendLongMessage(chatId, message, { parse_mode: 'HTML', disable_web_page_preview: true });
        logger.info(`Cross-analysis message sent successfully to chat ID: ${chatId}`);
    } catch (error) {
        logger.error('Failed to send cross-analysis message', { error });
        await bot.sendLongMessage(chatId, 'An error occurred while formatting the cross-analysis message.');
    }
};

const formatCrossAnalysisWallet = (wallet, contractAddresses, tokenInfos, rank) => {
    try {
        if (!wallet) {
            logger.error('Invalid wallet data provided', { wallet });
            return '';
        }

        const shortAddress = `${wallet.address.slice(0, 4)}...${wallet.address.slice(-4)}`;
        const pnlEmoji = getEmojiForPnl(wallet.walletCheckerData?.total_value || 0);

        let result = `${rank}. <a href="https://solscan.io/account/${wallet.address}">${shortAddress}</a> ${pnlEmoji} <a href="https://gmgn.ai/sol/address/${wallet.address}">gmgn</a>/<a href="https://app.cielo.finance/profile/${wallet.address}/pnl/tokens">cielo</a>\n`;

        if (wallet.walletCheckerData) {
            const { total_value, sol_balance, realized_profit_30d, unrealized_profit, winrate } = wallet.walletCheckerData;
            const winratePercentage = (winrate * 100).toFixed(2);

            result += `├ 💼 Port: $${formatNumber(total_value, 0)} (SOL: ${formatNumber(sol_balance, 2)})\n`;
            result += `├ 💰 P/L (30d): $${formatNumber(realized_profit_30d, 0)} 📈 uP/L: $${formatNumber(unrealized_profit, 0)}\n`;
            result += `├ 📊 Winrate (30d): ${winratePercentage}%\n`;
        }

        result += `└ 🔗 Combined Value: $${formatNumber(wallet.combinedValue)} (`;
        result += contractAddresses.map(address => {
            const tokenInfo = tokenInfos.find(t => t.address === address);
            const value = wallet[`value_${address}`] || 0;
            return `${tokenInfo.symbol}: $${formatNumber(value)}`;
        }).join(', ');
        result += ')\n';

        return result;
    } catch (error) {
        logger.error('Error formatting wallet data', { wallet, error });
        return '';
    }
};

module.exports = { 
    sendFormattedCrossAnalysisMessage,
    formatCrossAnalysisWallet
};
