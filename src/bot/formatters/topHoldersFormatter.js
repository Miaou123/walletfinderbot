const { truncateAddress  } = require('./generalFormatters');
const logger = require('../../utils/logger');

/**
 * Format number with commas for thousands
 * @param {number|string} num - Number to format
 * @param {number} decimals - Decimal places to show
 * @returns {string} Formatted number
 */
const formatNumber = (num, decimals = 0) => {
  if (num === undefined || num === null || num === '') return 'N/A';
  
  let parsedNum;
  if (typeof num === 'string') {
    parsedNum = parseFloat(num.replace(/,/g, ''));
  } else {
    parsedNum = num;
  }
  
  if (isNaN(parsedNum)) return 'N/A';
  
  // Handle different magnitude ranges
  if (Math.abs(parsedNum) >= 1000000) {
    return (parsedNum / 1000000).toFixed(1) + 'M';
  } else if (Math.abs(parsedNum) >= 1000) {
    return (parsedNum / 1000).toFixed(1) + 'k';
  }
  
  return parsedNum.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

/**
 * Format analysis message with support for pagination
 * @param {Array} analyzedWallets - Wallets to display
 * @param {Object} tokenInfo - Token information
 * @param {boolean} isPaginated - Whether this is being displayed with pagination
 * @param {number} currentPage - Current page number (for pagination)
 * @param {number} totalPages - Total number of pages (for pagination)
 * @param {number} totalWallets - Total wallet count (for pagination)
 * @param {string} currentCategory - Currently selected category (for filtering)
 * @param {Object} categoryCounts - Counts of wallets per category
 * @returns {Object} Formatted message and errors
 */
const formatAnalysisMessage = (
  analyzedWallets, 
  tokenInfo, 
  isPaginated = false,
  currentPage = 0,
  totalPages = 1,
  totalWallets = 0,
  currentCategory = 'All',
  categoryCounts = null
) => {
  logger.info(`Formatting topholders message for ${tokenInfo.symbol}`);
  let finalMessage = '';
  const errors = [];

  try {
    // Ensure we have a valid wallet array
    let wallets;
    
    if (Array.isArray(analyzedWallets)) {
      wallets = analyzedWallets;
    } else if (analyzedWallets && Array.isArray(analyzedWallets.analyzedWallets)) {
      wallets = analyzedWallets.analyzedWallets;
    } else if (analyzedWallets && typeof analyzedWallets === 'object') {
      wallets = Object.values(analyzedWallets).flat().filter(Array.isArray);
    } else {
      throw new Error('Invalid analysis result: unable to find analyzed wallets');
    }

    // Build the header section
    finalMessage = `<b><a href="https://solscan.io/token/${tokenInfo.address}">${tokenInfo.name}</a></b> (${tokenInfo.symbol}) `;
    finalMessage += `<a href="https://dexscreener.com/solana/${tokenInfo.address}">📈</a>\n`;
    finalMessage += `<code>${tokenInfo.address}</code>\n\n`;

    // Add category counts if provided and we're on the first page
    if (categoryCounts && currentPage === 0) {
      finalMessage += `<b>Distribution among top ${totalWallets} wallets:</b>\n`;
      finalMessage += `🐳 ${categoryCounts.whales} whales\n`;
      finalMessage += `🆕 ${categoryCounts.fresh} fresh wallets\n`;
      finalMessage += `💤 ${categoryCounts.inactive} inactive wallets\n\n`;

      // Add known address categories if they exist
      if (categoryCounts.dex > 0) {
        finalMessage += `💧 ${categoryCounts.dex} liquidity pools\n`;
      }
      if (categoryCounts.exchange > 0) {
        finalMessage += `🏦 ${categoryCounts.exchange} exchanges\n`;
      }
      if (categoryCounts.bridge > 0) {
        finalMessage += `🌉 ${categoryCounts.bridge} bridges\n`;
      }
    }

    // If we have category stats, add them
    if (analyzedWallets.categoryStats) {
      const stats = analyzedWallets.categoryStats;
      
      if (stats['High Value']) {
        finalMessage += `🐳 ${stats['High Value'].count} whale wallets (${stats['High Value'].supplyPercentage.toFixed(2)}% worth $${formatNumber(stats['High Value'].totalValue)})\n`;
      }
      
      if (stats['Low Transactions']) {
        finalMessage += `🆕 ${stats['Low Transactions'].count} fresh wallets (${stats['Low Transactions'].supplyPercentage.toFixed(2)}% worth $${formatNumber(stats['Low Transactions'].totalValue)})\n`;
      }
      
      if (stats['Inactive']) {
        finalMessage += `💤 ${stats['Inactive'].count} inactive wallets (${stats['Inactive'].supplyPercentage.toFixed(2)}% worth $${formatNumber(stats['Inactive'].totalValue)})\n`;
      }
    }

    // Add pagination info if paginated
    if (isPaginated) {
      let categoryDisplay = currentCategory;
      if (currentCategory === 'High Value') categoryDisplay = 'Whales';
      else if (currentCategory === 'Low Transactions') categoryDisplay = 'Fresh';
      
      finalMessage += `<b>Showing${currentCategory !== 'All' ? ' ' + categoryDisplay : ''} wallets (${wallets.length})</b>\n`;
      finalMessage += `Page ${currentPage + 1} of ${totalPages} (${totalWallets} total)\n\n`;
    } else {
      finalMessage += `\n`;
    }

    // Format wallets based on the displayed wallets
    wallets.forEach((wallet, index) => {
      const categoryEmoji = wallet.category === 'High Value' ? '🐳' : 
                            wallet.category === 'Low Transactions' ? '🆕' : 
                            wallet.category === 'Inactive' ? '💤' : '👤';
      
      const displayIndex = isPaginated ? (currentPage * wallets.length) + index + 1 : index + 1;

      if (wallet.category === 'High Value' || !wallet.category) {
        finalMessage += formatSingleWallet(wallet, displayIndex, tokenInfo, categoryEmoji);
      } else {
        finalMessage += formatSimpleWallet(wallet, displayIndex, tokenInfo, categoryEmoji);
        
        if (wallet.category === 'Inactive' && wallet.daysSinceLastRelevantSwap) {
          finalMessage += `Last swap: ${Math.floor(wallet.daysSinceLastRelevantSwap)}d ago\n`;
        }
      }
      
      finalMessage += '\n\n';
    });

  } catch (error) {
    logger.error('Error in formatAnalysisMessage:', error);
    errors.push(`Error in analysis formatting: ${error.message}`);
    finalMessage = 'An error occurred while formatting the analysis results.';
  }

  // Return both message and errors
  return { messages: [finalMessage], errors };
};

const formatSingleWallet = (wallet, index, tokenInfo, categoryEmoji = '🐳') => {
  try {
    const rank = index;
    const portfolioValue = parseFloat(wallet.stats?.totalValue || 0);
    
    // Check if this is a known address (DEX, Exchange, etc.)
    let finalCategoryEmoji = categoryEmoji;
    let addressNameDisplay = '';
    
    if (wallet.knownAddress) {
      // Use a droplet emoji for DEX/Liquidity pools
      if (wallet.addressCategory === 'DEX') {
        finalCategoryEmoji = '💧'; // Droplet emoji for liquidity pools/DEXes
      } else if (wallet.addressCategory === 'Exchange') {
        finalCategoryEmoji = '🏦'; // Bank emoji for exchanges
      } else if (wallet.addressCategory === 'Bridge') {
        finalCategoryEmoji = '🌉'; // Bridge emoji for bridges
      }
      
      // Add the address name in bold
      if (wallet.addressName) {
        addressNameDisplay = ` <b>${wallet.addressName}</b>`;
      }
    }
    
    let info = `${rank}. ${finalCategoryEmoji}${addressNameDisplay} <a href="https://solscan.io/account/${wallet.address}">${truncateAddress(wallet.address)}</a> → ${formatNumber(wallet.supplyPercentage, 2)}% `;
    
    // For known DEX/Exchange addresses, show simplified info
    if (wallet.knownAddress && (wallet.addressCategory === 'DEX' || wallet.addressCategory === 'Exchange')) {
      info += `\n└ 💼 Holds ${formatNumber(wallet.supplyPercentage, 2)}% of supply`;
      return info;
    }
    
    // For regular wallets, show normal info
    info += `<a href="https://gmgn.ai/sol/address/${wallet.address}">gmgn</a>/` +
            `<a href="https://app.cielo.finance/profile/${wallet.address}/pnl/tokens">cielo</a>\n`;

    info += `├ 💼 Port: ${formatNumber(portfolioValue)} (SOL: ${formatNumber(wallet.solBalance, 2)})\n`;

    if (wallet.pnl30d !== undefined && wallet.unrealizedPnl !== undefined) {
      info += `├ 💰 P/L (30d): ${formatNumber(wallet.pnl30d)} 📈 uPnL: ${formatNumber(wallet.unrealizedPnl)}\n`;
    }

    if (wallet.winrate !== undefined) {
      info += `└ 📊 Winrate (30d): ${formatNumber(wallet.winrate, 2)}%`;
    } else {
      info += `└ 📊 Winrate: N/A`;
    }
  
    if (wallet.stats?.tokenInfos && wallet.stats.tokenInfos.length > 0) {
      const topTokens = wallet.stats.tokenInfos
        .filter(token => token.symbol !== 'SOL' && token.symbol !== tokenInfo.symbol && parseFloat(token.value) >= 1000)
        .sort((a, b) => parseFloat(b.value) - parseFloat(a.value))
        .slice(0, 3);
  
      if (topTokens.length > 0) {
        info += ` (${topTokens.map(token => 
          `<a href="https://dexscreener.com/solana/${token.mint}?maker=${wallet.address}">${token.symbol}</a> ${formatNumber(token.value)}`
        ).join(', ')})`;
      }
    }
  
    return info;
  } catch (error) {
    logger.error('Error in formatSingleWallet:', error);
    return '';
  }
};

// Similarly update formatSimpleWallet
const formatSimpleWallet = (wallet, index, tokenInfo, categoryEmoji = '🆕') => {
  try {
    const rank = index;
    const shortAddress = truncateAddress(wallet.address);
    
    // Check if this is a known address (DEX, Exchange, etc.)
    let finalCategoryEmoji = categoryEmoji;
    let addressNameDisplay = '';
    
    if (wallet.knownAddress) {
      // Use a droplet emoji for DEX/Liquidity pools
      if (wallet.addressCategory === 'DEX') {
        finalCategoryEmoji = '💧'; // Droplet emoji for liquidity pools/DEXes
      } else if (wallet.addressCategory === 'Exchange') {
        finalCategoryEmoji = '🏦'; // Bank emoji for exchanges
      } else if (wallet.addressCategory === 'Bridge') {
        finalCategoryEmoji = '🌉'; // Bridge emoji for bridges
      }
      
      // Add the address name in bold
      if (wallet.addressName) {
        addressNameDisplay = ` <b>${wallet.addressName}</b>`;
      }
    }
    
    let info = `${rank}. ${finalCategoryEmoji}${addressNameDisplay} <a href="https://solscan.io/account/${wallet.address}">${shortAddress}</a> → ${formatNumber(wallet.supplyPercentage, 2)}% `;
    
    // For known DEX/Exchange addresses, show simplified info
    if (wallet.knownAddress && (wallet.addressCategory === 'DEX' || wallet.addressCategory === 'Exchange')) {
      return info;
    }
    
    // For regular wallets, show normal info
    info += `<a href="https://gmgn.ai/sol/address/${wallet.address}">gmgn</a>/` +
            `<a href="https://app.cielo.finance/profile/${wallet.address}/pnl/tokens">cielo</a>\n`;

    // Add portfolio info if available
    if (wallet.tokenValueUsd) {
      info += `└ 💼 Port: ${formatNumber(wallet.tokenValueUsd)}`;
    } else {
      info += `└ 💼 Port: N/A`;
    }
    
    // For inactive wallets, add last activity info
    if (categoryEmoji === '💤' && wallet.daysSinceLastRelevantSwap) {
      info += ` (Last activity: ${Math.floor(wallet.daysSinceLastRelevantSwap)}d ago)`;
    }
    
    return info;
  } catch (error) {
    logger.error('Error in formatSimpleWallet:', error);
    return '';
  }
};

/**
 * Calculate statistics for wallets by category
 * For use in paginated displays
 * @param {Object} categorizedWallets - Wallets categorized by type
 * @returns {Object} Stats by category
 */
const calculateCategoryStats = (categorizedWallets) => {
  const stats = {};
  
  for (const [category, wallets] of Object.entries(categorizedWallets)) {
    if (!Array.isArray(wallets)) continue;
    
    const totalWallets = wallets.length;
    const supplyPercentage = wallets.reduce((sum, w) => sum + parseFloat(w.supplyPercentage || 0), 0);
    const totalValue = wallets.reduce((sum, w) => sum + parseFloat(w.tokenValueUsd || 0), 0);
    
    stats[category] = {
      count: totalWallets,
      supplyPercentage: supplyPercentage,
      totalValue: totalValue
    };
  }
  
  return stats;
};

module.exports = {
  formatNumber,
  formatAnalysisMessage,
  formatSingleWallet,
  formatSimpleWallet,
  calculateCategoryStats
};