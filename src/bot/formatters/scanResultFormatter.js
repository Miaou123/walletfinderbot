// src/formatters/scanResultFormatter.js
const { formatNumber } = require('./generalFormatters');

/**
 * Format the scan result for a token analysis.
 * @param {Object} tokenInfo - Information about the token.
 * @param {Array} finalWallets - List of analyzed wallets.
 * @param {number} totalSupplyControlled - Percentage of the total supply controlled by top holders.
 * @param {number} averagePortfolioValue - Average portfolio value of the holders.
 * @param {number} notableAddresses - Count of notable addresses found.
 * @param {string} tokenAddress - The token address.
 * @returns {string} - The formatted result string.
 */
function formatScanResult(tokenInfo, finalWallets, totalSupplyControlled, averagePortfolioValue, notableAddresses, tokenAddress) {
  let result = `<b><a href="https://solscan.io/token/${tokenAddress}">${tokenInfo.name}</a></b> (${tokenInfo.symbol}) `;
  result += `<a href="https://dexscreener.com/solana/${tokenAddress}">📈</a>\n`;
  result += `<code>${tokenAddress}</code>\n\n`;

  if (finalWallets.length === 0) {
    return result + "<strong>No valid holders found after filtering.</strong>\n";
  }

  result += `<strong>Top ${finalWallets.length} holders analysis (excluding liquidity pools and bots):</strong>\n`;
  result += `👥 Supply Controlled: ${totalSupplyControlled.toFixed(2)}%\n`;
  result += `💰 Average portfolio Value: $${(averagePortfolioValue / 1000).toFixed(2)}K\n`;
  result += `❗️ Notable Addresses: ${notableAddresses}\n\n`;
  result += `<strong>Holders Info</strong>\n\n`;

  finalWallets.forEach((wallet, index) => {
    result += formatWalletInfo(wallet, index);
  });

  return result;
}

/**
 * Format a single wallet's information for display.
 * @param {Object} wallet - The wallet information.
 * @param {number} index - The rank of the wallet.
 * @returns {string} - Formatted string for the wallet.
 */
function formatWalletInfo(wallet, index) {
  let info = `${index + 1} - <a href="https://solscan.io/account/${wallet.address}">${wallet.address.substring(0, 6)}...${wallet.address.slice(-4)}</a> → (${wallet.supplyPercentage}%) ${getHoldingEmoji(wallet)}\n`;
  
  if (wallet.isInteresting) {
    info += `├ ❗️${wallet.category}\n`;
  }

  info += `├ 💳 Sol: ${wallet.solBalance}\n`;
  info += `└ 💲 Port: $${formatNumber(parseFloat(wallet.portfolioValue))}`;

  if (wallet.tokenInfos && wallet.tokenInfos.length > 0) {
    const topTokens = wallet.tokenInfos
      .filter(token => token.symbol !== 'SOL' && token.valueNumber >= 1000)
      .sort((a, b) => b.valueNumber - a.valueNumber)
      .slice(0, 3);

    if (topTokens.length > 0) {
      info += ` (${topTokens.map(token => 
        `<a href="https://dexscreener.com/solana/${token.mint}?maker=${wallet.address}">${token.symbol}</a> $${formatNumber(token.valueNumber)}`
      ).join(', ')})`;
    }
  }

  return info + '\n\n';
}

/**
 * Get emoji based on the total value of the wallet.
 * @param {Object} wallet - The wallet information.
 * @returns {string} - The corresponding emoji.
 */
function getHoldingEmoji(wallet) {
  const totalValue = parseFloat(wallet.portfolioValue);
  if (totalValue > 100000) return '🐳';
  if (totalValue > 50000) return '🦈';
  if (totalValue > 10000) return '🐬';
  if (totalValue > 1000) return '🐟';
  return '🦐';
}

module.exports = { formatScanResult };
