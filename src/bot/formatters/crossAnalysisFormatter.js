const { formatNumber, getEmojiForPnl } = require('./generalFormatters');
const logger = require('../../utils/logger');

/**
 * Calculate statistics about holder combinations
 * @param {Array} filteredHolders - Holders that match the criteria
 * @param {Array} tokenInfos - Information about tokens
 * @returns {Object} Statistics about holder combinations
 */
const calculateHolderStats = (filteredHolders, tokenInfos) => {
    const stats = {
        total: filteredHolders.length,
        combinations: {}
    };

    tokenInfos.forEach((token, i) => {
        tokenInfos.slice(i + 1).forEach((otherToken, j) => {
            const key = `${token.symbol}/${otherToken.symbol}`;
            stats.combinations[key] = filteredHolders.filter(h => 
                h.tokensHeld && h.tokensHeld.has(i) && h.tokensHeld.has(i + j + 1)
            ).length;
        });
    });

    const allTokensKey = tokenInfos.map(t => t.symbol).join('/');
    stats.combinations[allTokensKey] = filteredHolders.filter(h => 
        h.tokensHeld && h.tokensHeld.size === tokenInfos.length
    ).length;

    return stats;
};

/**
 * Format cross-analysis message for display with pagination support
 * @param {Array} pageHolders - Holders to display on the current page
 * @param {Array} contractAddresses - Contract addresses analyzed
 * @param {Array} tokenInfos - Token information
 * @param {number} currentPage - Current page number
 * @param {number} totalPages - Total number of pages
 * @param {number} totalHolders - Total number of holders found
 * @param {number} holdersPerPage - Number of holders per page
 * @param {boolean} isPaginated - Whether pagination is enabled
 * @returns {string} Formatted message
 */
const formatCrossAnalysisMessage = (
    pageHolders, 
    contractAddresses, 
    tokenInfos, 
    currentPage = 0,
    totalPages = 1,
    totalHolders = 0,
    holdersPerPage = 5,
    isPaginated = false
) => {
    try {
        if (!Array.isArray(pageHolders) || pageHolders.length === 0) {
            return 'No common holders found matching the criteria.';
        }

        // Calculate stats for all holders
        const holderStats = calculateHolderStats(pageHolders, tokenInfos);

        // Create header
        let message = `<b>Cross-Analysis Results for ${tokenInfos.map(t => `<a href="https://solscan.io/token/${t.address}">${t.symbol}</a>`).join(' ')}</b>\n\n`;
        
        if (isPaginated) {
            // Add pagination info in header
            const startIndex = currentPage * holdersPerPage + 1;
            const endIndex = Math.min((currentPage + 1) * holdersPerPage, totalHolders);
            message += `<b>Showing ${startIndex}-${endIndex} of ${totalHolders} holders</b>\n`;
            message += `Page ${currentPage + 1} of ${totalPages}\n\n`;
        } else {
            message += `Total common holders: <code><b>${holderStats.total}</b></code>\n\n`;
        }

        // Add combination statistics (only on first page or non-paginated)
        if (currentPage === 0 || !isPaginated) {
            Object.entries(holderStats.combinations)
                .sort((a, b) => b[1] - a[1])
                .forEach(([combination, count]) => {
                    message += `${combination}: <b>${formatNumber(count)}</b>\n`;
                });
            
            message += `\n`;
        }

        // Format wallets for the current page
        const walletMessages = pageHolders.map((wallet, index) => {
            // Calculate absolute index for display (1-based)
            const displayIndex = isPaginated ? 
                (currentPage * holdersPerPage) + index + 1 : 
                index + 1;
            return formatCrossAnalysisWallet(wallet, contractAddresses, tokenInfos, displayIndex);
        });

        const validMessages = walletMessages.filter(msg => msg !== '');
        message += validMessages.join('\n');

        return message;
    } catch (error) {
        logger.error('Failed to format cross-analysis message', { error });
        return 'An error occurred while formatting the cross-analysis message.';
    }
};

/**
 * Format a single wallet from cross-analysis
 * @param {Object} wallet - Wallet data
 * @param {Array} contractAddresses - Contract addresses analyzed
 * @param {Array} tokenInfos - Token information
 * @param {number} rank - Display rank
 * @returns {string} Formatted wallet string
 */
const formatCrossAnalysisWallet = (wallet, contractAddresses, tokenInfos, rank) => {
    try {
        if (!wallet) {
            logger.error('Invalid wallet data provided', { wallet });
            return '';
        }

        const shortAddress = `${wallet.address.slice(0, 4)}...${wallet.address.slice(-4)}`;
        const pnlEmoji = getEmojiForPnl(wallet.walletCheckerData?.total_value || 0);

        let result = `${rank}. <a href="https://solscan.io/account/${wallet.address}">${shortAddress}</a> ${pnlEmoji} <a href="https://gmgn.ai/sol/address/${wallet.address}">gmgn</a>/<a href="https://app.cielo.finance/profile/${wallet.address}/pnl/tokens">cielo</a>\n`;
        result += `├ 🪙 Tokens held: <b>${wallet.tokensHeld ? wallet.tokensHeld.size : 0}/${contractAddresses.length}</b>\n`;

        if (wallet.walletCheckerData) {
            const { total_value, sol_balance, realized_profit_30d, unrealized_profit, winrate } = wallet.walletCheckerData;
            const winratePercentage = winrate ? (winrate * 100).toFixed(2) : 'N/A';

            result += `├ 💼 Port: $<b>${formatNumber(total_value, 0)}</b> (SOL: <b>${formatNumber(sol_balance, 2)}</b>)\n`;
            result += `├ 💰 P/L (30d): $<b>${formatNumber(realized_profit_30d, 0)}</b> 📈 uPnL: $<b>${formatNumber(unrealized_profit, 0)}</b>\n`;
            result += `├ 📊 Winrate (30d): <b>${winratePercentage}%</b>\n`;
        }

        result += `└ 🔗 Combined Value: $<b>${formatNumber(wallet.combinedValue)}</b> (`;
        result += contractAddresses.map(address => {
            const tokenInfo = tokenInfos.find(t => t.address === address);
            if (!tokenInfo) return null;
            
            const value = wallet[`value_${address}`] || 0;
            if (value > 0) {
                return `<a href="https://solscan.io/token/${address}">${tokenInfo.symbol}</a>: $${formatNumber(value)}`;
            }
            return null;
        }).filter(Boolean).join(', ');
        result += ')\n';

        return result;
    } catch (error) {
        logger.error('Error formatting wallet data', { error });
        return '';
    }
};

/**
 * Send formatted cross-analysis message
 * @param {Object} bot - Telegram bot instance
 * @param {string} chatId - Chat ID to send message to
 * @param {Array} filteredHolders - Holders matching criteria
 * @param {Array} contractAddresses - Contract addresses analyzed
 * @param {Array} tokenInfos - Token information
 * @returns {Promise<void>}
 */
const sendFormattedCrossAnalysisMessage = async (bot, chatId, filteredHolders, contractAddresses, tokenInfos) => {
    try {
        if (!Array.isArray(filteredHolders) || filteredHolders.length === 0) {
            logger.warn('No filtered holders to format');
            await bot.sendLongMessage(chatId, 'No common holders found matching the criteria.');
            return;
        }

        const message = formatCrossAnalysisMessage(
            filteredHolders,
            contractAddresses,
            tokenInfos
        );

        await bot.sendLongMessage(chatId, message, { parse_mode: 'HTML', disable_web_page_preview: true });
        logger.info(`Cross-analysis message sent successfully to chat ID: ${chatId}`);
    } catch (error) {
        logger.error('Failed to send cross-analysis message', { error });
        await bot.sendLongMessage(chatId, 'An error occurred while formatting the cross-analysis message.');
    }
};

module.exports = { 
    sendFormattedCrossAnalysisMessage,
    formatCrossAnalysisMessage,
    formatCrossAnalysisWallet,
    calculateHolderStats
};