const { formatNumber, truncateAddress, getEmojiForPnl } = require('./generalFormatters');
const logger = require('../../utils/logger');

/**
 * Format the scan result for a token analysis.
 */
function formatScanResult(tokenInfo, finalWallets, totalSupplyControlled, averagePortfolioValue, notableAddresses, tokenAddress) {
  let result = `<b><a href="https://solscan.io/token/${tokenAddress}">${tokenInfo.name}</a></b> (${tokenInfo.symbol}) `;
  result += `<a href="https://dexscreener.com/solana/${tokenAddress}">📈</a>\n`;
  result += `<code>${tokenAddress}</code>\n\n`;

  if (finalWallets.length === 0) {
    return result + "<strong>No valid holders found after filtering.</strong>\n";
  }

  result += `<strong>Top ${finalWallets.length} holders analysis:</strong>\n`;
  logger.debug('Before formatting totalSupplyControlled:', totalSupplyControlled);
  result += `👥 Supply Controlled: ${formatNumber(totalSupplyControlled, 2, true)}\n`;
  result += `💰 Average portfolio Value: ${formatNumber(averagePortfolioValue)}\n`;
  result += `❗️ Notable Addresses: ${formatNumber(notableAddresses, 0)}\n\n`;
  result += `<strong>Holders Info</strong>\n\n`;

  finalWallets.forEach((wallet, index) => {
    result += formatWalletInfo(wallet, index);
  });

  return result;
}

/**
 * Format a single wallet's information for display.
 */
function formatWalletInfo(wallet, index) {
  const portfolioValue = parseFloat(wallet.portfolioValue);
  
  let info = `${index + 1} - <a href="https://solscan.io/account/${wallet.address}">${truncateAddress(wallet.address)}</a> → ${formatNumber(wallet.supplyPercentage, 2, true)} ${getWalletTypeEmoji(wallet, portfolioValue)}  <a href="https://gmgn.ai/sol/address/${wallet}">gmgn</a>/<a href="https://app.cielo.finance/profile/${wallet}/pnl/tokens">cielo</a> \n`;
  
  if (wallet.isInteresting) {
    const categoryEmoji = getCategoryEmoji(wallet.category);
    let categoryInfo = `${categoryEmoji} ${wallet.category}`;
    if (wallet.category === 'Pool' && wallet.poolType) {
      categoryInfo += ` (${wallet.poolType})`;
    }
    info += `├ ${categoryInfo}\n`;
  }

  info += `├ 💳 Sol: ${formatNumber(wallet.solBalance, 2)}\n`;
  info += `└ 💲 Port: ${formatNumber(portfolioValue)}`;

  if (wallet.tokenInfos && wallet.tokenInfos.length > 0) {
    const topTokens = wallet.tokenInfos
      .filter(token => token.symbol !== 'SOL' && token.valueNumber >= 1000)
      .sort((a, b) => b.valueNumber - a.valueNumber)
      .slice(0, 3);

    if (topTokens.length > 0) {
      info += ` (${topTokens.map(token => 
        `<a href="https://dexscreener.com/solana/${token.mint}?maker=${wallet.address}">${token.symbol}</a> ${formatNumber(token.valueNumber)}`
      ).join(', ')})`;
    }
  }

  return info + '\n\n';
}

/**
 * Get emoji based on the wallet type and value.
 */
function getWalletTypeEmoji(wallet, portfolioValue) {
  switch (wallet.walletType) {
    case 'bot':
      return '🤖';
    case 'pool':
      return '💧';
    default:
      return getEmojiForPnl(portfolioValue);
  }
}

/**
 * Get emoji for wallet category.
 */
function getCategoryEmoji(category) {
  switch (category) {
    case 'High Value':
      return '💰';
    case 'Fresh Address':
      return '🆕';
    case 'Inactive':
      return '💤';
    case 'Bot':
      return '🤖';
    case 'Pool':
      return '💧';
    default:
      return '❗️'; 
  }
}

module.exports = { formatScanResult };