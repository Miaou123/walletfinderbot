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
                    profit_change
                } = data.data;

                const winratePercentage = (winrate * 100).toFixed(2);
                const portfolioEmoji = total_value > 100000 ? '🐳' : '🐬';
                const truncatedWallet = truncateAddress(wallet);
                
                // Extraction du numéro de rank à partir de wallet_tag_v2 (si présent)
                let rankNumber = '';
                if (wallet_tag_v2 && wallet_tag_v2.startsWith('TOP')) {
                    // Extraire le nombre et le formater comme les autres nombres
                    const rankValue = parseInt(wallet_tag_v2.replace('TOP', ''), 10);
                    if (!isNaN(rankValue)) {
                        rankNumber = formatNumber(rankValue, 0);
                    }
                }
                
                // Formatage du profit pour le token spécifique
                const profitChangeDisplay = profit_change !== undefined && profit_change !== null ? 
                    `Token PnL%: ${formatNumber(profit_change, 0)}%` : 'Token PnL%: N/A%';

                let formattedString = `${index + 1}. <a href="https://solscan.io/account/${wallet}">${truncatedWallet}</a> ${portfolioEmoji} <a href="https://gmgn.ai/sol/address/${wallet}">gmgn</a>/<a href="https://app.cielo.finance/profile/${wallet}/pnl/tokens">cielo</a>\n`;
                
                // Nouvelle ligne pour le rank et le PnL
                if (rankNumber || profitChangeDisplay) {
                    formattedString += `├ 🪙 ${rankNumber && profitChangeDisplay !== 'Token PnL%: N/A' ? '' : ''}${profitChangeDisplay}\n`;
                }
                
                formattedString += `├ 💼 Port: $${formatNumber(total_value, 0)} (SOL: ${sol_balance ? formatNumber(sol_balance, 2) : 'N/A'})\n`;
                formattedString += `├ 💰 PnL (30d): $${formatNumber(realized_profit_30d, 0)} 📈 uPnL: $${unrealized_profit ? formatNumber(unrealized_profit, 0) : 'N/A'}\n`;
                formattedString += `└ 📊 Winrate (30d): ${formatNumber(winratePercentage)}%`;

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