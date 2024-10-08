const { formatNumber, truncateAddress, getEmojiForPnl } = require('./generalFormatters');
const logger = require('../../utils/logger');

const MAX_MESSAGE_LENGTH = 4096; // Limite de caractères pour un message Telegram

/**
 * Format an array of best traders and group them into Telegram message blocks.
 * @param {Array} traders - List of trader objects to format.
 * @returns {Array} Array of formatted message strings.
 */
function formatBestTraders(traders) {
    try {
        if (!Array.isArray(traders) || traders.length === 0) {
            logger.warn('No traders provided to format.');
            return ['No traders data available for formatting.'];
        }

        const formattedTraders = traders.map((trader, index) => formatTrader(trader, index + 1));
        logger.info('Formatted traders successfully.');
        return groupTraders(formattedTraders);
    } catch (error) {
        logger.error('Error in formatBestTraders function', { error });
        return ['An error occurred while formatting traders.'];
    }
}

/**
 * Format a single trader's data into a string.
 * @param {Object} trader - Trader object containing wallet and data properties.
 * @param {number} index - Index of the trader in the list.
 * @returns {string} Formatted trader string.
 */
function formatTrader(trader, index) {
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
        const pnlEmoji = getEmojiForPnl(total_value);
        const truncatedWallet = truncateAddress(wallet);

        let formattedString = `${index}. <a href="https://solscan.io/account/${wallet}">${truncatedWallet}</a> ${pnlEmoji} <a href="https://gmgn.ai/sol/address/${wallet}">gmgn</a>/<a href="https://app.cielo.finance/profile/${wallet}/pnl/tokens">cielo</a>\n`;
        formattedString += `├ 💼 Port: $${formatNumber(total_value, 0)} (SOL: ${formatNumber(sol_balance, 2)})\n`;
        formattedString += `├ 💰 P/L (30d): $${formatNumber(realized_profit_30d, 0)} 📈 uP/L: $${formatNumber(unrealized_profit, 0)}\n`;
        formattedString += `└ 📊 Winrate (30d): ${winratePercentage}%`;

        return formattedString;
    } catch (error) {
        logger.error('Error formatting a single trader', { trader, index, error });
        return '';
    }
}

/**
 * Group formatted traders into message chunks that fit within the Telegram character limit.
 * @param {Array} formattedTraders - List of formatted trader strings.
 * @returns {Array} List of message strings.
 */
function groupTraders(formattedTraders) {
    try {
        const messages = [];
        let currentMessage = "";

        for (const trader of formattedTraders) {
            if (currentMessage.length + trader.length + 2 > MAX_MESSAGE_LENGTH) {
                messages.push(currentMessage.trim());
                currentMessage = trader + "\n\n";
            } else {
                currentMessage += trader + "\n\n";
            }
        }

        if (currentMessage) {
            messages.push(currentMessage.trim());
        }

        logger.info('Grouped traders into message blocks successfully.');
        return messages;
    } catch (error) {
        logger.error('Error in groupTraders function', { error });
        return ['An error occurred while grouping traders.'];
    }
}

module.exports = { formatBestTraders };
