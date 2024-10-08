const logger = require('../../utils/logger');
const { formatNumber } = require('./walletAnalyzerFormatter');
const { getEmojiForPnl, truncateAddress } = require('./generalFormatters');

const MINIMUM_PORT_SIZE = 1000;

const formatEarlyBuyersMessage = (earlyBuyers, tokenInfo, hours, coinAddress) => {
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

const formatSingleWallet = (buyer, index, tokenInfo, coinAddress) => {
  try {
    const rank = index + 1;
    const truncatedWallet = buyer.walletAddress ? truncateAddress(buyer.walletAddress) : 'Unknown Address';
    const amountFormatted = formatNumber(Number(buyer.amount) / Math.pow(10, tokenInfo.decimals));
    
    let pnlEmoji = '❓';
    if (buyer.walletInfo && buyer.walletInfo.total_value) {
      pnlEmoji = getEmojiForPnl(buyer.walletInfo.total_value);
    }

    let result = `${rank}. <a href="https://solscan.io/account/${buyer.walletAddress}">${truncatedWallet}</a> ${pnlEmoji} `;
    result += `<a href="https://gmgn.ai/sol/address/${buyer.walletAddress}">gmgn</a>/`;
    result += `<a href="https://app.cielo.finance/profile/${buyer.walletAddress}/pnl/tokens">cielo</a>\n`;
    
    result += `├ 🪙 Total Amount: ${amountFormatted} ${tokenInfo.symbol}\n`;

    if (buyer.walletInfo) {
      const walletData = buyer.walletInfo;
      
      if (walletData.total_value) {
        const solBalance = walletData.sol_balance ? ` ( Sol: ${formatNumber(walletData.sol_balance, 2)} )` : '';
        result += `├ 💼 Port: $${formatNumber(walletData.total_value, 0)}${solBalance}\n`;
      }

      if (walletData.realized_profit_30d || walletData.unrealized_profit) {
        const realizedPL = walletData.realized_profit_30d ? `$${formatNumber(walletData.realized_profit_30d, 0)}` : 'N/A';
        const unrealizedPL = walletData.unrealized_profit ? `$${formatNumber(walletData.unrealized_profit, 0)}` : 'N/A';
        result += `├ 💰 P/L (30d): ${realizedPL} / uP/L: ${unrealizedPL}\n`;
      }

      if (walletData.winrate) {
        const winratePercentage = (walletData.winrate * 100).toFixed(2);
        result += `└ 📊 Winrate (30d): ${winratePercentage}%`;
      }
    }

    return result + '\n\n';
  } catch (error) {
    logger.error(`Error formatting single wallet: ${error.message}`);
    return `Error formatting wallet ${buyer.walletAddress || 'Unknown'}\n\n`;
  }
};

module.exports = { formatEarlyBuyersMessage };