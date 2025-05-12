const { formatNumber, truncateAddress, getEmojiForPnl } = require('./generalFormatters');
const logger = require('../../utils/logger');

/**
 * Format an array of best traders into a single message string.
 * @param {Array} traders - List of trader objects to format.
 * @param {Object} params - Command parameters.
 * @param {boolean} isPaginated - Whether this is being displayed in paginated view.
 * @returns {string} Formatted message string.
 */
function formatBestTraders(traders, params, isPaginated = false) {
    try {
        if (!Array.isArray(traders) || traders.length === 0) {
            logger.warn('No traders provided to format.');
            return 'No traders data available for formatting.';
        }

        const { contractAddress, winrateThreshold, portfolioThreshold, sortOption } = params;

        // Header of the message
        const header = [
            `🏆 <b>Best traders analysis for:</b>`,
            `<code>${contractAddress}</code>`,
            `📊 Winrate threshold: <code>>${winrateThreshold}%</code>`,
            `💰 Portfolio threshold: <code>$${formatNumber(portfolioThreshold)}</code>`,
            `📈 Sorted by: <code>${sortOption}</code>`
        ].join('\n');
        
        // Add different footer based on pagination mode
        let paginationInfo = '';
        if (isPaginated) {
            paginationInfo = `\n\nShowing ${traders.length} traders (navigate with buttons below)`;
        } else {
            paginationInfo = `\n\nClick /bt to customize these values\n`;
        }
        
        const tradersList = traders.map((trader, index) => {
            try {
                const { wallet, data } = trader;
                if (!wallet || !data) {
                    logger.error('Invalid trader data encountered', { trader });
                    return '';
                }

                const { 
                    winrate, 
                    sol_balance, 
                    total_value,
                    unrealized_profit,
                    realized_profit_30d,
                    wallet_tag_v2,
                    total_pnl_percent,
                } = data.data;

                const winratePercentage = (winrate * 100).toFixed(2);
                const portfolioEmoji = total_value > 100000 ? '🐳' : '🐬';
                const truncatedWallet = truncateAddress(wallet);
                
                // Emoji for the token
                const tokenEmoji = '🪙';
                
                // Extract rank number from wallet_tag_v2 if present
                let rankNumber = '';
                if (wallet_tag_v2 && wallet_tag_v2.startsWith('TOP')) {
                    // Extract the number and format it
                    const rankValue = parseInt(wallet_tag_v2.replace('TOP', ''), 10);
                    if (!isNaN(rankValue)) {
                        rankNumber = formatNumber(rankValue, 0);
                    }
                }
                
                // Format total PnL with formatNumber
                let totalPnLDisplay = 'PnL: N/A';
                if (total_pnl_percent !== undefined && total_pnl_percent !== null) {
                    const sign = total_pnl_percent >= 0 ? '+' : '';
                    totalPnLDisplay = `PnL: ${sign}${formatNumber(total_pnl_percent, 2)}%`;
                }

                let formattedString = `${index + 1}. <a href="https://solscan.io/account/${wallet}">${truncatedWallet}</a> ${portfolioEmoji} <a href="https://gmgn.ai/sol/address/${wallet}">gmgn</a>/<a href="https://app.cielo.finance/profile/${wallet}/pnl/tokens">cielo</a>\n`;
                
                // Line only for PnL (without rank)
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

        return `${header}${paginationInfo}\n\n${tradersList}`;
    } catch (error) {
        logger.error('Error in formatBestTraders function:', error);
        return 'An error occurred while formatting traders.';
    }
}

/**
 * Format initial loading message
 * @param {Object} params - Command parameters
 * @returns {string} Formatted message
 */
function formatInitialMessage(params) {
    const { contractAddress, winrateThreshold, portfolioThreshold, sortOption } = params;
    return [
        `🎯 <b>Analyzing best traders for contract:</b>`,
        `<code>${contractAddress}</code>`,
        `📊 Winrate threshold: <code>>${winrateThreshold}%</code>`,
        `💰 Portfolio threshold: <code>$${formatNumber(portfolioThreshold)}</code>`,
        `📈 Sorting by: <code>${sortOption}</code>`,
        ``,
        `Please wait while we fetch and analyze the data...`
    ].join('\n');
}

module.exports = { formatBestTraders, formatInitialMessage };