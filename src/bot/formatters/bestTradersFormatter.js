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
                    wallet_tag_v2,
                    profit_change,
                    total_pnl_percent,
                    token_realized_profit,
                    token_unrealized_profit
                } = data.data;

                const winratePercentage = (winrate * 100).toFixed(2);
                const portfolioEmoji = total_value > 100000 ? '🐳' : '🐬';
                const truncatedWallet = truncateAddress(wallet);
                
                // Emoji pour le token (vous pouvez ajuster selon vos besoins)
                const tokenEmoji = '🪙';
                
                // Extraction du numéro de rank à partir de wallet_tag_v2 (si présent)
                let rankNumber = '';
                if (wallet_tag_v2 && wallet_tag_v2.startsWith('TOP')) {
                    // Extraire le nombre et le formater comme les autres nombres
                    const rankValue = parseInt(wallet_tag_v2.replace('TOP', ''), 10);
                    if (!isNaN(rankValue)) {
                        rankNumber = formatNumber(rankValue, 0);
                    }
                }
                
                // Formatage du PnL total avec formatNumber
                let totalPnLDisplay = 'PnL: N/A';
                if (total_pnl_percent !== undefined && total_pnl_percent !== null) {
                    const sign = total_pnl_percent >= 0 ? '+' : '';
                    totalPnLDisplay = `PnL: ${sign}${formatNumber(total_pnl_percent, 2)}%`;
                }

                let formattedString = `${index + 1}. <a href="https://solscan.io/account/${wallet}">${truncatedWallet}</a> ${portfolioEmoji} <a href="https://gmgn.ai/sol/address/${wallet}">gmgn</a>/<a href="https://app.cielo.finance/profile/${wallet}/pnl/tokens">cielo</a>\n`;
                
                // Ligne uniquement pour le PnL (sans rank)
                if (totalPnLDisplay !== 'PnL: N/A') {
                    formattedString += `├ ${tokenEmoji} ${totalPnLDisplay}\n`;
                }
                
                formattedString += `├ 💼 Port: $${formatNumber(total_value, 0)} (SOL: ${sol_balance ? formatNumber(sol_balance, 2) : 'N/A'})\n`;
                formattedString += `├ 💰 P/L (30d): $${formatNumber(realized_profit_30d, 0)} 📈 uPnL: $${unrealized_profit ? formatNumber(unrealized_profit, 0) : 'N/A'}\n`;
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