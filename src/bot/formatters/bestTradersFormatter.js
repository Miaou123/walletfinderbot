const { formatNumber, truncateAddress, getEmojiForPnl } = require('./generalFormatters');
const logger = require('../../utils/logger');

/**
 * Format an array of best traders into a single message string.
 * @param {Array} traders - List of trader objects to format.
 * @returns {string} Formatted message string.
 */
function formatBestTraders(traders, params) {
    try {
        if (!Array.isArray(traders) || traders.length === 0) {
            logger.warn('No traders provided to format.');
            return 'No traders data available for formatting.';
        }

        const { contractAddress, winrateThreshold, portfolioThreshold, sortOption } = params;

        // Header du message
        const header = [
            `🏆 <b>Best traders analysis for:</b>`,
            `<code>${contractAddress}</code>`,
            `📊 Winrate threshold: <code>>${winrateThreshold}%</code>`,
            `💰 Portfolio threshold: <code>$${portfolioThreshold}</code>`,
            `📈 Sorted by: <code>${sortOption}</code>`,
            ``,
            `Click /bt to customize these values\n`,
            ``
        ].join('\n');

        const tradersList = traders.map((trader, index) => {
            try {
                const { wallet, data } = trader;
                if (!wallet || !data) {
                    logger.error('Invalid trader data encountered', { trader });
                    return '';
                }

                const { 
                    winrate, 
                    pnl_30d, 
                    sol_balance, 
                    total_value,
                    unrealized_profit,
                    realized_profit_30d,
                } = data.data;

                const winratePercentage = (winrate * 100).toFixed(2);
                const portfolioEmoji = total_value > 100000 ? '🐳' : '🐬';
                const truncatedWallet = truncateAddress(wallet);

                let formattedString = `${index + 1}. <a href="https://solscan.io/account/${wallet}">${truncatedWallet}</a> ${portfolioEmoji} <a href="https://gmgn.ai/sol/address/${wallet}">gmgn</a>/<a href="https://app.cielo.finance/profile/${wallet}/pnl/tokens">cielo</a>\n`;
                formattedString += `├ 💼 Port: $${formatNumber(total_value, 0)} (SOL: ${sol_balance ? formatNumber(sol_balance, 2) : 'N/A'})\n`;
                formattedString += `├ 💰 P/L (30d): $${formatNumber(realized_profit_30d, 0)} 📈 uP/L: $${unrealized_profit ? formatNumber(unrealized_profit, 0) : 'N/A'}\n`;
                formattedString += `└ 📊 Winrate (30d): ${winratePercentage}%`;

                return formattedString;
            } catch (error) {
                logger.error('Error formatting individual trader:', error);
                return '';
            }
        }).filter(str => str !== '').join('\n\n');

        return `${header}${tradersList}`;
    } catch (error) {
        logger.error('Error in formatBestTraders function:', error);
        return 'An error occurred while formatting traders.';
    }
}

function formatInitialMessage(params) {
    const { contractAddress, winrateThreshold, portfolioThreshold, sortOption } = params;
    return [
        `🎯 <b>Analyzing best traders for contract:</b>`,
        `<code>${contractAddress}</code>`,
        `📊 Winrate threshold: <code>>${winrateThreshold}%</code>`,
        `💰 Portfolio threshold: <code>$${portfolioThreshold}</code>`,
        `📈 Sorting by: <code>${sortOption}</code>`,
        ``,
        `Click /bt to customize these values`
    ].join('\n');
}

module.exports = { formatBestTraders, formatInitialMessage };