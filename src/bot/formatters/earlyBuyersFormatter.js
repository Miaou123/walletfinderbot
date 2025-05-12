const logger = require('../../utils/logger');
const { formatNumber } = require('./topHoldersFormatter');
const { getEmojiForPnl, truncateAddress } = require('./generalFormatters');

const MINIMUM_PORT_SIZE = 1000;

/**
 * Format early buyers message without pagination
 * @param {Array} earlyBuyers - List of early buyers
 * @param {Object} tokenInfo - Token information
 * @param {number} hours - Time frame in hours
 * @param {string} coinAddress - Token address
 * @param {string} pumpFlag - Optional flag for pumpfun filtering
 * @returns {string} Formatted message
 */
const formatEarlyBuyersMessage = async (earlyBuyers, tokenInfo, hours, coinAddress, pumpFlag) => {
  logger.info(`Formatting early buyers message for ${tokenInfo.symbol}`);

  try {
    if (!Array.isArray(earlyBuyers)) {
      throw new Error('Invalid earlyBuyers data: expected an array');
    }

    if (earlyBuyers.length === 0) {
      return "No early buyers found in the specified time frame.";
    }

    let message = `<b>Early Buyers Analysis for ${tokenInfo.symbol}</b>\n\n`;

    const getPortValue = (buyer) => {
      try {
        const portSize = buyer.walletInfo && buyer.walletInfo.total_value;
        return typeof portSize === 'number' ? portSize : 0;
      } catch (error) {
        logger.error(`Error getting port value for buyer: ${error.message}`);
        return 0;
      }
    };

    // Filter and sort by portfolio value (highest first)
    const filteredBuyers = earlyBuyers
      .filter(buyer => getPortValue(buyer) >= MINIMUM_PORT_SIZE)
      .sort((a, b) => getPortValue(b) - getPortValue(a));

    logger.debug(`Found ${filteredBuyers.length} filtered early buyers`);
    message += `${filteredBuyers.length} early buyers found\n\n`;

    for (const [index, buyer] of filteredBuyers.entries()) {
      message += formatSingleWallet(buyer, index, tokenInfo, coinAddress);
    }

    return message;
  } catch (error) {
    logger.error(`Error in formatEarlyBuyersMessage: ${error.message}`);
    return "An error occurred while formatting early buyers message.";
  }
};

/**
 * Format a single wallet for display in early buyers list (non-paginated version)
 * @param {Object} buyer - Buyer data
 * @param {number} index - Index in the list
 * @param {Object} tokenInfo - Token information
 * @param {string} coinAddress - Token address
 * @returns {string} Formatted wallet entry
 */
const formatSingleWallet = (buyer, index, tokenInfo, coinAddress) => {
  try {
    const rank = index + 1;
    const truncatedWallet = buyer.wallet ? truncateAddress(buyer.wallet) : 'Unknown Address';

    // Add 💊 emoji if dex is 'pumpfun'
    const dexEmoji = buyer.dex === 'pumpfun' ? '💊' : '';

    let pnlEmoji = '❓';
    if (buyer.walletInfo && buyer.walletInfo.total_value) {
      pnlEmoji = getEmojiForPnl(buyer.walletInfo.total_value);
    }

    let result = `${rank}. ${dexEmoji} <a href="https://solscan.io/account/${buyer.wallet}">${truncatedWallet}</a> ${pnlEmoji} `;
    result += `<a href="https://gmgn.ai/sol/address/${buyer.wallet}">gmgn</a>/`;
    result += `<a href="https://app.cielo.finance/profile/${buyer.wallet}/pnl/tokens">cielo</a>\n`;

    // Display total amounts bought and sold in tokens and USD
    const totalBoughtAmount = formatNumber(buyer.bought_amount_token, 2);
    const totalSoldAmount = formatNumber(buyer.sold_amount_token, 2);

    const totalBoughtUsd = formatNumber(buyer.bought_amount_usd, 2);
    const totalSoldUsd = formatNumber(buyer.sold_amount_usd, 2);

    result += `├ 🪙 Total Amount bought: ${totalBoughtAmount} ${tokenInfo.symbol} ($${totalBoughtUsd})\n`;
    result += `├ 🧻 Total Amount sold: ${totalSoldAmount} ${tokenInfo.symbol} ($${totalSoldUsd})\n`;

    if (buyer.walletInfo) {
      const walletData = buyer.walletInfo;

      if (walletData.total_value) {
        const solBalance = walletData.sol_balance ? ` (Sol: ${formatNumber(walletData.sol_balance, 2)})` : '';
        result += `├ 💼 Port: $${formatNumber(walletData.total_value, 0)}${solBalance}\n`;
      }

      if (walletData.realized_profit_30d || walletData.unrealized_profit) {
        const realizedPL = walletData.realized_profit_30d ? `$${formatNumber(walletData.realized_profit_30d, 0)}` : 'N/A';
        const unrealizedPL = walletData.unrealized_profit ? `$${formatNumber(walletData.unrealized_profit, 0)}` : 'N/A';
        result += `├ 💰 P/L (30d): ${realizedPL} / uPnL: ${unrealizedPL}\n`;
      }

      if (walletData.winrate) {
        const winratePercentage = (walletData.winrate * 100).toFixed(2);
        result += `└ 📊 Winrate (30d): ${winratePercentage}%`;
      }
    }

    return result + '\n\n';
  } catch (error) {
    logger.error(`Error formatting single wallet: ${error.message}`);
    return `Error formatting wallet ${buyer.wallet || 'Unknown'}\n\n`;
  }
};

/**
 * Helper function to get portfolio value from buyer
 * @param {Object} buyer - Buyer data
 * @returns {number} - Portfolio value or 0 if not available
 */
const getPortValue = (buyer) => {
  try {
    const portSize = buyer.walletInfo && buyer.walletInfo.total_value;
    return typeof portSize === 'number' ? portSize : 0;
  } catch (error) {
    logger.error(`Error getting port value for buyer: ${error.message}`);
    return 0;
  }
};

/**
 * Format early buyers message with pagination support
 * @param {Array} earlyBuyers - List of early buyers for the current page
 * @param {Object} tokenInfo - Token information
 * @param {number} hours - Time frame in hours
 * @param {string} coinAddress - Token address
 * @param {string} pumpFlag - Optional flag for pumpfun filtering
 * @param {number} currentPage - Current page number
 * @param {number} totalPages - Total number of pages
 * @param {number} totalResults - Total number of results
 * @param {number} itemsPerPage - Number of items per page
 * @returns {string} Formatted message with pagination
 */
const formatEarlyBuyersMessagePaginated = (earlyBuyers, tokenInfo, hours, coinAddress, pumpFlag, currentPage, totalPages, totalResults, itemsPerPage) => {
    try {
        if (!Array.isArray(earlyBuyers) || earlyBuyers.length === 0) {
            return "No early buyers found in the specified time frame.";
        }

        // Create the header with token info and analysis parameters
        let message = `<b>Early Buyers Analysis for ${tokenInfo.symbol}</b>\n\n`;
        message += `🪙 Token: ${tokenInfo.name} (${tokenInfo.symbol})\n`;
        message += `⏳ Time frame: ${hours} hours\n`;
        message += `📊 Analysis type: ${pumpFlag === 'pump' ? "Pumpfun only" : 
                                       pumpFlag === 'nopump' ? "Pumpfun excluded" : 
                                       "Standard"}\n\n`;
        
        // Add pagination info
        message += `<b>Found ${totalResults} early buyers</b> (showing ${currentPage * itemsPerPage + 1}-${Math.min((currentPage + 1) * itemsPerPage, totalResults)})\n\n`;

        // Format each buyer
        earlyBuyers.forEach((buyer, index) => {
            const globalIndex = (currentPage * itemsPerPage) + index + 1;
            message += formatSingleBuyer(buyer, globalIndex, tokenInfo, coinAddress);
            message += '\n\n';
        });

        // Add page indicator
        if (totalPages > 1) {
            message += `<i>Page ${currentPage + 1} of ${totalPages}</i>`;
        }

        return message;
    } catch (error) {
        logger.error(`Error in formatEarlyBuyersMessagePaginated: ${error.message}`);
        return "An error occurred while formatting early buyers message.";
    }
};

/**
 * Format a single buyer entry for paginated display
 * @param {Object} buyer - Buyer data
 * @param {number} index - Global index in the list
 * @param {Object} tokenInfo - Token information
 * @param {string} coinAddress - Token address
 * @returns {string} Formatted buyer entry
 */
const formatSingleBuyer = (buyer, index, tokenInfo, coinAddress) => {
    try {
        const truncatedWallet = buyer.wallet ? 
            `${buyer.wallet.substring(0, 6)}...${buyer.wallet.slice(-4)}` : 
            'Unknown Address';

        // Add dex emoji if pumpfun
        const dexEmoji = buyer.dex === 'pumpfun' ? '💊' : '';

        let pnlEmoji = '❓';
        if (buyer.walletInfo && buyer.walletInfo.total_value) {
            // Set emoji based on portfolio value
            pnlEmoji = getEmojiForPnl(buyer.walletInfo.total_value);
        }

        let result = `${index}. ${dexEmoji} <a href="https://solscan.io/account/${buyer.wallet}">${truncatedWallet}</a> ${pnlEmoji} `;
        result += `<a href="https://gmgn.ai/sol/address/${buyer.wallet}">gmgn</a>/`;
        result += `<a href="https://app.cielo.finance/profile/${buyer.wallet}/pnl/tokens">cielo</a>\n`;

        // Show amounts bought and sold
        const totalBoughtAmount = formatNumber(buyer.bought_amount_token, 2);
        const totalSoldAmount = formatNumber(buyer.sold_amount_token, 2);
        const totalBoughtUsd = formatNumber(buyer.bought_amount_usd, 2);
        const totalSoldUsd = formatNumber(buyer.sold_amount_usd, 2);

        result += `├ 🪙 Total Amount bought: ${totalBoughtAmount} ${tokenInfo.symbol} ($${totalBoughtUsd})\n`;
        result += `├ 🧻 Total Amount sold: ${totalSoldAmount} ${tokenInfo.symbol} ($${totalSoldUsd})\n`;

        // Add wallet info if available
        if (buyer.walletInfo) {
            const walletData = buyer.walletInfo;

            if (walletData.total_value) {
                const solBalance = walletData.sol_balance ? ` (Sol: ${formatNumber(walletData.sol_balance, 2)})` : '';
                result += `├ 💼 Port: $${formatNumber(walletData.total_value, 0)}${solBalance}\n`;
            }

            if (walletData.realized_profit_30d || walletData.unrealized_profit) {
                const realizedPL = walletData.realized_profit_30d ? `$${formatNumber(walletData.realized_profit_30d, 0)}` : 'N/A';
                const unrealizedPL = walletData.unrealized_profit ? `$${formatNumber(walletData.unrealized_profit, 0)}` : 'N/A';
                result += `├ 💰 P/L (30d): ${realizedPL} / uPnL: ${unrealizedPL}\n`;
            }

            if (walletData.winrate) {
                const winratePercentage = (walletData.winrate * 100).toFixed(2);
                result += `└ 📊 Winrate (30d): ${winratePercentage}%`;
            } else {
                result += `└ 📊 Winrate: N/A`;
            }
        }

        return result;
    } catch (error) {
        logger.error(`Error formatting single buyer: ${error.message}`);
        return `Error formatting wallet ${buyer.wallet || 'Unknown'}\n`;
    }
};

module.exports = { 
    formatEarlyBuyersMessage,
    formatEarlyBuyersMessagePaginated,
    formatSingleWallet,
    formatSingleBuyer,
    getPortValue
};