const { formatNumber, truncateAddress, getEmojiForPnl } = require('./generalFormatters');
const logger = require('../../utils/logger');
const BigNumber = require('bignumber.js');

/**
 * UnifiedFormatter - Centralized formatting system for consistent output
 * Reduces code duplication across multiple formatters
 */
class UnifiedFormatter {
  /**
   * Format token information header
   * @param {Object} tokenInfo - Token information object
   * @param {string} commandName - Command name for context
   * @returns {string} Formatted token header
   */
  formatTokenHeader(tokenInfo, commandName) {
    if (!tokenInfo) {
      return '❓ Unknown Token';
    }

    const symbol = tokenInfo.symbol || 'Unknown';
    const name = tokenInfo.name || 'Unknown Token';
    const priceUsd = tokenInfo.priceUsd ? `$${formatNumber(tokenInfo.priceUsd, 8)}` : 'N/A';
    const marketCap = tokenInfo.marketCap ? `$${formatNumber(tokenInfo.marketCap, 0)}` : 'N/A';
    const address = tokenInfo.address || '';
    
    return [
      `🪙 <b>${symbol} - ${name}</b>`,
      `💵 Price: <code>${priceUsd}</code>`,
      `💰 Market Cap: <code>${marketCap}</code>`,
      `📝 Address: <code>${address}</code>`,
      ''
    ].join('\n');
  }

  /**
   * Format wallet information
   * @param {Object} wallet - Wallet object with holdings and data
   * @param {boolean} includeLinks - Whether to include external links
   * @returns {string} Formatted wallet information
   */
  formatWallet(wallet, includeLinks = true) {
    try {
      if (!wallet || !wallet.address) {
        return '';
      }
      
      const address = wallet.address;
      const truncatedAddress = truncateAddress(address);
      const solBalance = wallet.solBalance ? formatNumber(wallet.solBalance, 2) : 'N/A';
      const portfolioValue = wallet.totalValueUsd ? `$${formatNumber(wallet.totalValueUsd, 0)}` : 'N/A';
      
      // Determine wallet emoji based on portfolio value
      let walletEmoji = '👛';
      if (wallet.totalValueUsd > 100000) walletEmoji = '🐳';
      else if (wallet.totalValueUsd > 10000) walletEmoji = '🐬';
      
      // Create base wallet info
      let walletInfo = `${walletEmoji} <code>${truncatedAddress}</code>`;
      
      // Add links if requested
      if (includeLinks) {
        walletInfo = `${walletEmoji} <a href="https://solscan.io/account/${address}">${truncatedAddress}</a> <a href="https://gmgn.ai/sol/address/${address}">gmgn</a>/<a href="https://cielo.finance/wallet/${address}">cielo</a>`;
      }
      
      // Create formatted lines
      const lines = [`${walletInfo}`];
      
      // Add basic wallet stats
      if (wallet.tokenSymbol && wallet.tokenBalance) {
        const tokenValue = wallet.tokenValueUsd ? `$${formatNumber(wallet.tokenValueUsd, 2)}` : 'N/A';
        const supplyPercent = wallet.supplyPercentage ? `${wallet.supplyPercentage}%` : 'N/A';
        lines.push(`├ 🪙 ${formatNumber(wallet.tokenBalance)} ${wallet.tokenSymbol} (${supplyPercent}) - ${tokenValue}`);
      }
      
      // Add portfolio value
      lines.push(`├ 💼 Portfolio: ${portfolioValue} - SOL: ${solBalance}`);
      
      // Add trader stats if available
      if (wallet.winrate) {
        const winrateValue = formatNumber(wallet.winrate, 2);
        const pnl30d = wallet.pnl30d ? `$${formatNumber(wallet.pnl30d, 0)}` : 'N/A';
        lines.push(`└ 📊 Winrate: ${winrateValue}% - P/L (30d): ${pnl30d}`);
      } else {
        lines.push(`└ ${wallet.category || 'Standard wallet'}`);
      }
      
      return lines.join('\n');
    } catch (error) {
      logger.error('Error formatting wallet:', error);
      return `Failed to format wallet: ${truncateAddress(wallet.address || 'unknown')}`;
    }
  }

  /**
   * Format a list of wallets
   * @param {Array} wallets - Array of wallet objects
   * @param {Object} options - Formatting options
   * @returns {string} Formatted wallet list
   */
  formatWalletList(wallets, options = {}) {
    if (!wallets || !Array.isArray(wallets) || wallets.length === 0) {
      return 'No wallets to display.';
    }
    
    const {
      title = 'Wallet Analysis',
      maxWallets = 20,
      includeLinks = true,
      includeIndex = true,
      showStats = true,
      sortBy = null, // null, 'value', 'balance'
      filter = null  // Function to filter wallets
    } = options;
    
    // Filter wallets if needed
    let filteredWallets = wallets;
    if (filter && typeof filter === 'function') {
      filteredWallets = wallets.filter(filter);
    }
    
    // Sort wallets if requested
    if (sortBy === 'value') {
      filteredWallets.sort((a, b) => (b.totalValueUsd || 0) - (a.totalValueUsd || 0));
    } else if (sortBy === 'balance') {
      filteredWallets.sort((a, b) => (b.tokenBalance || 0) - (a.tokenBalance || 0));
    }
    
    // Limit number of wallets to display
    const displayWallets = filteredWallets.slice(0, maxWallets);
    
    // Format each wallet
    const walletStrings = displayWallets.map((wallet, index) => {
      let formattedWallet = this.formatWallet(wallet, includeLinks);
      if (includeIndex) {
        formattedWallet = `${index + 1}. ${formattedWallet.split('\n').join('\n   ')}`;
      }
      return formattedWallet;
    });
    
    // Add stats if requested
    let statsString = '';
    if (showStats) {
      const totalValue = filteredWallets.reduce((sum, w) => sum + (w.totalValueUsd || 0), 0);
      const totalWallets = filteredWallets.length;
      
      statsString = [
        '',
        `📊 <b>Summary:</b>`,
        `Total wallets: ${totalWallets}`,
        `Total value: $${formatNumber(totalValue, 0)}`,
        `Average value: $${formatNumber(totalValue / totalWallets, 0)}`,
        ''
      ].join('\n');
    }
    
    // Create final output
    const output = [
      `<b>${title}</b>`,
      '',
      walletStrings.join('\n\n'),
      statsString
    ].join('\n');
    
    return output;
  }

  /**
   * Format cross-token analysis results
   * @param {Object} crossAnalysis - Cross token analysis results
   * @returns {string} Formatted cross analysis
   */
  formatCrossAnalysis(crossAnalysis) {
    if (!crossAnalysis || !crossAnalysis.commonWallets) {
      return 'No cross-analysis data available.';
    }
    
    const { tokens, commonWallets, stats } = crossAnalysis;
    
    // Format token information
    const tokenList = tokens.map(token => 
      `• ${token.symbol}: <code>${truncateAddress(token.address)}</code> - $${formatNumber(token.priceUsd, 8)}`
    ).join('\n');
    
    // Format header
    const header = [
      `🔍 <b>Cross-Token Analysis</b>`,
      ``,
      `<b>Analyzed Tokens:</b>`,
      tokenList,
      ``,
      `<b>Common Holders (${commonWallets.length}):</b>`,
      ``
    ].join('\n');
    
    // Format wallets (limited to 15 to avoid message size issues)
    const limitedWallets = commonWallets.slice(0, 15);
    const walletDetails = limitedWallets.map((wallet, index) => {
      // Format holdings
      const holdingsList = wallet.holdings.map(holding => 
        `   • ${holding.symbol}: ${formatNumber(holding.amount)} ($${formatNumber(holding.valueUsd, 2)})`
      ).join('\n');
      
      return [
        `${index + 1}. <a href="https://solscan.io/account/${wallet.address}">${truncateAddress(wallet.address)}</a>`,
        `├ 🪙 ${wallet.tokenCount}/${tokens.length} tokens (${formatNumber(wallet.coveragePercent, 0)}%)`,
        `├ 💰 Total value: $${formatNumber(wallet.totalValueUsd, 0)}`,
        `└ Holdings:`,
        holdingsList
      ].join('\n');
    }).join('\n\n');
    
    // Combine all sections
    return `${header}${walletDetails}`;
  }

  /**
   * Format token holder analysis 
   * @param {Array} holders - Array of token holders
   * @param {Object} tokenInfo - Token information
   * @returns {Object} Formatted messages and any errors
   */
  formatHolderAnalysis(holders, tokenInfo) {
    try {
      if (!holders || !Array.isArray(holders) || holders.length === 0) {
        return { messages: ['No holder data available.'], errors: [] };
      }
      
      const headerMessage = this.formatTokenHeader(tokenInfo, 'Top Holders');
      
      // Group wallets by category
      const categorized = {
        'High Value': [],
        'Trader': [],
        'Low Transactions': [],
        'Inactive': [],
        'Other': []
      };
      
      holders.forEach(holder => {
        if (holder.isInteresting && holder.category) {
          if (categorized[holder.category]) {
            categorized[holder.category].push(holder);
          } else {
            categorized['Other'].push(holder);
          }
        } else {
          categorized['Other'].push(holder);
        }
      });
      
      // Format each category
      const messages = [];
      messages.push(headerMessage);
      
      // Format high value wallets
      if (categorized['High Value'].length > 0) {
        const highValueMsg = this.formatWalletList(categorized['High Value'], {
          title: '🐳 High Value Wallets',
          maxWallets: 10,
          includeLinks: true,
          showStats: true,
          sortBy: 'value'
        });
        messages.push(highValueMsg);
      }
      
      // Format trader wallets
      if (categorized['Trader'].length > 0) {
        const traderMsg = this.formatWalletList(categorized['Trader'], {
          title: '📈 Active Trader Wallets',
          maxWallets: 10,
          includeLinks: true,
          showStats: true
        });
        messages.push(traderMsg);
      }
      
      // Format important categories
      for (const category of ['Inactive', 'Low Transactions']) {
        if (categorized[category].length > 0) {
          const catMsg = this.formatWalletList(categorized[category], {
            title: `👀 ${category} Wallets`,
            maxWallets: 10,
            includeLinks: true,
            showStats: true
          });
          messages.push(catMsg);
        }
      }
      
      // Format remaining wallets
      const otherMsg = this.formatWalletList(categorized['Other'], {
        title: '👛 Other Top Wallets',
        maxWallets: 10,
        includeLinks: true,
        showStats: true,
        sortBy: 'balance'
      });
      messages.push(otherMsg);
      
      return { messages, errors: [] };
    } catch (error) {
      logger.error('Error formatting holder analysis:', error);
      return { 
        messages: ['Error formatting holder analysis. Please try again.'], 
        errors: [error.message] 
      };
    }
  }

  /**
   * Format early buyers analysis
   * @param {Array} buyers - Early buyers data
   * @param {Object} tokenInfo - Token information
   * @param {Object} params - Analysis parameters
   * @returns {string} Formatted early buyers analysis
   */
  formatEarlyBuyers(buyers, tokenInfo, params) {
    if (!buyers || !Array.isArray(buyers) || buyers.length === 0) {
      return 'No early buyers data available.';
    }
    
    const { timeFrame, minHoldingPercent } = params;
    
    // Format header
    const header = [
      `🕵️ <b>Early Buyers Analysis for ${tokenInfo.symbol || 'Unknown Token'}</b>`,
      ``,
      `<b>Token:</b> ${tokenInfo.name || 'Unknown'} (${tokenInfo.symbol || '?'})`,
      `<b>Address:</b> <code>${tokenInfo.address || 'Unknown'}</code>`,
      `<b>Time Frame:</b> ${timeFrame}`,
      `<b>Min Holding:</b> ${minHoldingPercent}% of supply`,
      ``,
      `<b>Early Buyers (${buyers.length}):</b>`,
      ``
    ].join('\n');
    
    // Format each buyer
    const buyerDetails = buyers.slice(0, 15).map((buyer, index) => {
      const truncatedAddress = truncateAddress(buyer.wallet);
      const txCount = buyer.transactions ? buyer.transactions.length : 0;
      const percentOfSupply = formatNumber(buyer.percentOfSupply || 0, 2);
      const solBalance = buyer.solBalance ? formatNumber(buyer.solBalance, 2) : 'N/A';
      const walletData = buyer.walletData || {};
      const winrate = walletData.winrate ? formatNumber(walletData.winrate * 100, 0) : 'N/A';
      
      return [
        `${index + 1}. <a href="https://solscan.io/account/${buyer.wallet}">${truncatedAddress}</a>`,
        `├ 🪙 Bought: ${formatNumber(buyer.totalAmount)} (${percentOfSupply}% of supply)`,
        `├ 💰 Transactions: ${txCount} - SOL Balance: ${solBalance}`,
        `└ ${winrate !== 'N/A' ? `📊 Winrate: ${winrate}%` : '❓ No trading data'}`
      ].join('\n');
    }).join('\n\n');
    
    // Combine all sections
    return `${header}${buyerDetails}`;
  }

  /**
   * Format best traders analysis
   * @param {Array} traders - List of best traders
   * @param {Object} params - Command parameters
   * @returns {string} Formatted best traders analysis
   */
  formatBestTraders(traders, params) {
    try {
      if (!Array.isArray(traders) || traders.length === 0) {
        logger.warn('No traders provided to format.');
        return 'No traders data available for formatting.';
      }

      const { contractAddress, winrateThreshold, portfolioThreshold, sortOption } = params;

      // Format header
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

      // Format each trader
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
            total_pnl_percent
          } = data.data;

          // Calculate winrate percentage
          const winratePercentage = (winrate * 100).toFixed(2);
          
          // Set portfolio emoji based on value
          const portfolioEmoji = total_value > 100000 ? '🐳' : '🐬';
          
          // Format wallet address
          const truncatedWallet = truncateAddress(wallet);
          
          // Format total PnL if available
          let totalPnLDisplay = 'PnL: N/A';
          if (total_pnl_percent !== undefined && total_pnl_percent !== null) {
            const sign = total_pnl_percent >= 0 ? '+' : '';
            totalPnLDisplay = `PnL: ${sign}${formatNumber(total_pnl_percent, 2)}%`;
          }

          // Build formatted string - keeping original format
          let formattedString = `${index + 1}. <a href="https://solscan.io/account/${wallet}">${truncatedWallet}</a> ${portfolioEmoji} <a href="https://gmgn.ai/sol/address/${wallet}">gmgn</a>/<a href="https://app.cielo.finance/profile/${wallet}/pnl/tokens">cielo</a>\n`;
          
          // Show token PnL
          if (totalPnLDisplay !== 'PnL: N/A') {
            formattedString += `├ 🪙 ${totalPnLDisplay}\n`;
          }
          
          // Add portfolio and PnL info - keeping exactly the same format
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

  /**
   * Format loading message for best traders command
   * @param {Object} params - Command parameters
   * @returns {string} Formatted loading message
   */
  formatBestTradersLoading(params) {
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

  /**
   * Get emoji based on percentage for fresh wallets
   * @param {number} percentage - Percentage for emoji selection
   * @returns {string} Emoji representation
   */
  getFreshWalletEmoji(percentage) {
    if (percentage <= 10) return '🟢';
    if (percentage <= 20) return '🟡';
    if (percentage <= 40) return '🟠';
    if (percentage <= 50) return '🔴';
    return '☠️';
  }

/**
 * Format funding source information with clickable links
 * @param {string} funderAddress - Address of the funding source
 * @param {Object} fundingDetails - Details about the funding
 * @returns {string} - Formatted funding information
 */
formatFundingInfo(funderAddress, fundingDetails) {
  if (!funderAddress || !fundingDetails) return '';
  
  const fundingAmount = fundingDetails.amount ? `${fundingDetails.amount.toFixed(2)} SOL` : '';
  const txSignature = fundingDetails.signature || '';
  
  // Try to get source name from details or address categorization
  let sourceName = fundingDetails.sourceName;
  if (!sourceName) {
    try {
      // Import address categorization
      const addressCategorization = require('../../utils/addressCategorization');
      const addressInfo = addressCategorization.getAddressInfo(funderAddress);
      sourceName = addressInfo ? addressInfo.name : null;
    } catch (error) {
      logger.debug('Error importing addressCategorization:', error);
    }
  }
  
  const timeAgo = fundingDetails.timestamp ? this.formatTimeDifference(fundingDetails.timestamp) : '';
  
  // Format the transaction link
  const txLink = txSignature ? 
    `<a href="https://solscan.io/tx/${txSignature}">funded</a>` : 
    'funded';
  
  // Format funding info in a clean way with clickable links
  if (fundingAmount && sourceName) {
    // Make the source name clickable
    return ` | ${txLink} ${fundingAmount} from <a href="https://solscan.io/account/${funderAddress}">${sourceName}</a> ${timeAgo}`;
  } else if (fundingAmount) {
    return ` | ${txLink} ${fundingAmount} from <a href="https://solscan.io/account/${funderAddress}">${truncateAddress(funderAddress)}</a> ${timeAgo}`;
  }
  
  return '';
}

/**
 * Analyze and group wallets by their funding sources
 * @param {Array} analyzedWallets - All analyzed wallets
 * @param {string} category - Optional category filter (e.g., 'Fresh')
 * @returns {Object} - Grouped wallets by funding source
 */
analyzeFundingSources(analyzedWallets, category = null) {
  // Filter wallets with funding information
  const walletsWithFunding = analyzedWallets.filter(wallet => {
    // Apply category filter if provided
    const matchesCategory = category ? wallet.category === category : wallet.category !== 'Unknown';
    return matchesCategory && wallet.funderAddress && wallet.fundingDetails;
  });
  
  // Group wallets by funding source
  const fundingGroups = {};
  
  for (const wallet of walletsWithFunding) {
    const { funderAddress } = wallet;
    
    if (!fundingGroups[funderAddress]) {
      // Get source name if available
      let sourceName = wallet.fundingDetails.sourceName;
      if (!sourceName) {
        try {
          const addressCategorization = require('../../utils/addressCategorization');
          const addressInfo = addressCategorization.getAddressInfo(funderAddress);
          sourceName = addressInfo ? addressInfo.name : null;
        } catch (error) {
          logger.debug('Error importing addressCategorization:', error);
        }
      }
      
      fundingGroups[funderAddress] = {
        address: funderAddress,
        wallets: [],
        sourceName: sourceName || null,
        totalSupplyPercentage: 0,
        totalFundedAmount: 0
      };
    }
    
    // Add wallet to its funding group
    fundingGroups[funderAddress].wallets.push(wallet);
    
    // Add to total statistics
    if (wallet.percentageOfSupply) {
      fundingGroups[funderAddress].totalSupplyPercentage += parseFloat(wallet.percentageOfSupply);
    } else if (wallet.balance && wallet.fundingDetails.tokenInfo?.totalSupply) {
      const percentage = new BigNumber(wallet.balance)
        .dividedBy(wallet.fundingDetails.tokenInfo.totalSupply)
        .multipliedBy(100)
        .toNumber();
      fundingGroups[funderAddress].totalSupplyPercentage += percentage;
    }
    
    // Add funding amount if available
    if (wallet.fundingDetails.amount) {
      fundingGroups[funderAddress].totalFundedAmount += wallet.fundingDetails.amount;
    }
  }
  
  // Filter out groups with only one wallet
  return Object.values(fundingGroups).filter(group => group.wallets.length > 1);
}

/**
 * Format funding groups into a summary section
 * @param {Array} fundingGroups - Groups of wallets by funding source
 * @param {string} walletType - Type of wallets (team, fresh, etc.)
 * @returns {string} - Formatted summary section
 */
formatFundingGroupsSummary(fundingGroups, walletType = 'wallet') {
  if (!fundingGroups || fundingGroups.length === 0) {
    return '';
  }
  
  let summary = '\n\n<b>🔍 Common Funding Sources:</b>\n';
  
  // Format each funding group
  fundingGroups.forEach(group => {
    const sourceDisplay = group.sourceName 
      ? `<a href="https://solscan.io/account/${group.address}">${group.sourceName}</a>`
      : `<a href="https://solscan.io/account/${group.address}">${truncateAddress(group.address)}</a>`;
    
    summary += `• ${group.wallets.length} ${walletType} wallets funded from ${sourceDisplay} ` +
              `(${formatNumber(group.totalSupplyPercentage, 2)}% of supply, ${formatNumber(group.totalFundedAmount, 2)} SOL)\n`;
  });
  
  return summary;
}

/**
 * Enhance wallets with supply percentage information
 * @param {Array} wallets - Array of wallet objects
 * @param {Object} tokenInfo - Token information
 * @returns {Array} - Enhanced wallets with percentage info
 */
enhanceWalletsWithPercentage(wallets, tokenInfo) {
  return wallets.map(wallet => {
    const supplyPercentage = new BigNumber(wallet.balance)
      .dividedBy(tokenInfo.totalSupply)
      .multipliedBy(100)
      .toFixed(2);
    
    // Add token info to funding details for percentage calculations
    if (wallet.fundingDetails) {
      wallet.fundingDetails.tokenInfo = tokenInfo;
    }
    
    return { 
      ...wallet, 
      percentageOfSupply: supplyPercentage
    };
  });
}


/**
 * Format fresh wallets analysis result
 * @param {Array} analyzedWallets - All analyzed wallets 
 * @param {Object} tokenInfo - Token information
 * @param {Array} freshWallets - Fresh wallets only
 * @param {number} totalSupplyControlled - Percentage of supply controlled by fresh wallets
 * @returns {string} Formatted fresh wallets analysis
 */
formatFreshWalletsResult(analyzedWallets, tokenInfo, freshWallets, totalSupplyControlled) {
  try {
    let message = `<b>Fresh Wallets Analysis for <a href="https://dexscreener.com/solana/${tokenInfo.address}">${tokenInfo.symbol}</a></b>\n\n`;

    message += `🔥 Supply Controlled by Fresh Wallets: ${formatNumber(totalSupplyControlled, 2, true)} ${this.getFreshWalletEmoji(totalSupplyControlled)}\n`;
    message += `⚠️ Fresh Wallets Detected: ${freshWallets.length}\n\n`;
    message += `<b>Top Fresh Wallets:</b>\n`;

    const topFreshWallets = analyzedWallets
      .filter(w => w.category === 'Fresh')
      .sort((a, b) => new BigNumber(b.balance).minus(new BigNumber(a.balance)).toNumber())
      .slice(0, 10);

    topFreshWallets.forEach((wallet, index) => {
      const supplyPercentage = new BigNumber(wallet.balance)
        .dividedBy(tokenInfo.totalSupply)
        .multipliedBy(100)
        .toFixed(2);
        
      // Basic wallet info
      let walletLine = `${index + 1}. <a href="https://solscan.io/account/${wallet.address}">${truncateAddress(wallet.address)}</a> (${formatNumber(supplyPercentage, 2, true)})`;
      
      // Add funding info if available
      walletLine += this.formatFundingInfo(wallet.funderAddress, wallet.fundingDetails);
      
      message += `${walletLine}\n`;
    });

    return message;
  } catch (error) {
    logger.error('Error in formatFreshWalletsResult:', error);
    return 'Error formatting fresh wallets details.';
  }
}

/**
 * Format fresh wallet details for detailed view
 * @param {Array} analyzedWallets - All analyzed wallets
 * @param {Object} tokenInfo - Token information
 * @returns {string} Formatted wallet details
 */
formatFreshWalletDetails(analyzedWallets, tokenInfo) {
  try {
    const freshWallets = analyzedWallets.filter(wallet => wallet.category === 'Fresh');

    let message = `<b>${tokenInfo.symbol}</b> (<a href="https://dexscreener.com/solana/${tokenInfo.address}">📈</a>)\n`;
    message += `<b>${freshWallets.length} fresh wallet addresses:</b>\n\n`;

    freshWallets
      .sort((a, b) => {
        const balanceA = new BigNumber(a.balance).dividedBy(tokenInfo.totalSupply).multipliedBy(100);
        const balanceB = new BigNumber(b.balance).dividedBy(tokenInfo.totalSupply).multipliedBy(100);
        return balanceB.minus(balanceA).toNumber();
      })
      .forEach((wallet, index) => {
        const percentage = new BigNumber(wallet.balance)
          .dividedBy(tokenInfo.totalSupply)
          .multipliedBy(100)
          .toFixed(2);

        // Basic wallet info
        let walletLine = `${index + 1}. <a href="https://solscan.io/account/${wallet.address}">${truncateAddress(wallet.address)}</a> (${percentage}%)`;
        
        // Add funding info if available
        if (wallet.funderAddress && wallet.fundingDetails) {
          const fundingAmount = wallet.fundingDetails.amount ? `${wallet.fundingDetails.amount.toFixed(2)} SOL` : '';
          const txSignature = wallet.fundingDetails.signature || '';
          
          // Try to get source name from details or address categorization
          let sourceName = wallet.fundingDetails.sourceName;
          if (!sourceName) {
            try {
              const addressCategorization = require('../../utils/addressCategorization');
              const addressInfo = addressCategorization.getAddressInfo(wallet.funderAddress);
              sourceName = addressInfo ? addressInfo.name : null;
            } catch (error) {
              logger.debug('Error importing addressCategorization:', error);
            }
          }
          
          const timeAgo = wallet.fundingDetails.timestamp ? this.formatTimeDifference(wallet.fundingDetails.timestamp) : '';
          
          // Format the transaction link
          const txLink = txSignature ? 
            `<a href="https://solscan.io/tx/${txSignature}">funded</a>` : 
            'funded';
          
          let fundingInfo = '';
          
          if (fundingAmount && sourceName) {
            fundingInfo = `\n   └ ${txLink} ${fundingAmount} from <a href="https://solscan.io/account/${wallet.funderAddress}">${sourceName}</a> ${timeAgo}`;
          } else if (fundingAmount) {
            fundingInfo = `\n   └ ${txLink} ${fundingAmount} from <a href="https://solscan.io/account/${wallet.funderAddress}">${truncateAddress(wallet.funderAddress)}</a> ${timeAgo}`;
          }
          
          walletLine += fundingInfo;
        }
        
        message += `${walletLine}\n\n`;
      });

    return message;
  } catch (error) {
    logger.error('Error in formatFreshWalletDetails:', error);
    return 'Error formatting fresh wallet details.';
  }
}

/**
 * Generic wallet list formatter with common funding analysis
 * Can be used by both fresh and team commands
 * @param {Array} analyzedWallets - All analyzed wallets
 * @param {Object} tokenInfo - Token information
 * @param {Array} wallets - The wallets to display (fresh or team)
 * @param {number} totalSupplyControlled - Percentage of supply controlled
 * @param {Object} options - Formatting options
 * @returns {string} Formatted wallet analysis
 */
formatWalletAnalysis(analyzedWallets, tokenInfo, wallets, totalSupplyControlled, options = {}) {
  try {
    const {
      title = 'Wallet Analysis',
      emoji = '👥',
      warningEmoji = '⚠️',
      walletType = 'wallet',
      categoryFilter = null,
      displayCategory = false,
      maxWallets = 10
    } = options;
    
    // Start with the basic header
    let message = `<b>${title} for <a href="https://dexscreener.com/solana/${tokenInfo.address}">${tokenInfo.symbol}</a></b>\n\n`;
    message += `${emoji} Supply Controlled by ${walletType}s: ${formatNumber(totalSupplyControlled, 2, true)} ${this.getFreshWalletEmoji(totalSupplyControlled)}\n`;
    message += `${warningEmoji} Wallets flagged as ${walletType}s: ${wallets.length}`;
    
    // Add percentage of supply to each wallet for easier processing
    const enhancedWallets = this.enhanceWalletsWithPercentage(
      analyzedWallets.filter(w => !categoryFilter || w.category === categoryFilter),
      tokenInfo
    );
    
    // Analyze funding sources and get groups
    const fundingGroups = this.analyzeFundingSources(enhancedWallets, categoryFilter);
    
    // Add funding groups summary if there are any
    if (fundingGroups.length > 0) {
      const fundingSummary = this.formatFundingGroupsSummary(fundingGroups, walletType);
      message += fundingSummary;
    }
    
    // Add the top wallets section
    message += `\n\n<b>Top ${walletType} wallets:</b>\n`;
    
    // Sort wallets by balance and take top N
    const topWallets = enhancedWallets
      .sort((a, b) => new BigNumber(b.balance).minus(new BigNumber(a.balance)).toNumber())
      .slice(0, maxWallets);

    topWallets.forEach((wallet, index) => {
      const supplyPercentage = wallet.percentageOfSupply;
        
      // Basic wallet info
      let walletLine = `${index + 1}. <a href="https://solscan.io/account/${wallet.address}">${truncateAddress(wallet.address)}</a> (${formatNumber(supplyPercentage, 2, true)})`;
      
      // Add category if needed
      if (displayCategory) {
        walletLine += ` - ${wallet.category}`;
      }
      
      // Add funding info if available
      walletLine += this.formatFundingInfo(wallet.funderAddress, wallet.fundingDetails);
      
      message += `${walletLine}\n`;
    });

    return message;
  } catch (error) {
    logger.error(`Error in formatWalletAnalysis for ${walletType}:`, error);
    return `Error formatting ${walletType} details.`;
  }
}

/**
 * Generic wallet details formatter with common funding analysis
 * @param {Array} analyzedWallets - All analyzed wallets
 * @param {Object} tokenInfo - Token information
 * @param {Object} options - Formatting options
 * @returns {string} Formatted wallet details
 */
formatWalletDetails(analyzedWallets, tokenInfo, options = {}) {
  try {
    const {
      categoryFilter = null,
      displayCategory = true,
      walletType = 'wallet'
    } = options;
    
    // Filter wallets by category if needed
    const filteredWallets = categoryFilter 
      ? analyzedWallets.filter(wallet => wallet.category === categoryFilter)
      : analyzedWallets.filter(wallet => wallet.category !== 'Unknown');

    let message = `<b>${tokenInfo.symbol}</b> (<a href="https://dexscreener.com/solana/${tokenInfo.address}">📈</a>)\n`;
    message += `<b>${filteredWallets.length} ${walletType} addresses:</b>\n`;

    // Add percentage of supply to each wallet for easier processing
    const enhancedWallets = this.enhanceWalletsWithPercentage(filteredWallets, tokenInfo);
    
    // Analyze funding sources and get groups
    const fundingGroups = this.analyzeFundingSources(enhancedWallets, categoryFilter);
    
    // Add funding groups summary if there are any
    if (fundingGroups.length > 0) {
      const fundingSummary = this.formatFundingGroupsSummary(fundingGroups, walletType);
      message += fundingSummary;
    }
    
    message += '\n';

    enhancedWallets
      .sort((a, b) => {
        const balanceA = new BigNumber(a.balance).dividedBy(tokenInfo.totalSupply).multipliedBy(100);
        const balanceB = new BigNumber(b.balance).dividedBy(tokenInfo.totalSupply).multipliedBy(100);
        return balanceB.minus(balanceA).toNumber();
      })
      .forEach((wallet, index) => {
        const percentage = wallet.percentageOfSupply;

        // Basic wallet info
        let walletLine = `${index + 1}. <a href="https://solscan.io/account/${wallet.address}">${truncateAddress(wallet.address)}</a> (${percentage}%)`;
        
        // Add category if needed
        if (displayCategory) {
          walletLine += ` - ${wallet.category}`;
        }
        
        // Add funding info if available
        if (wallet.funderAddress && wallet.fundingDetails) {
          const fundingAmount = wallet.fundingDetails.amount ? `${wallet.fundingDetails.amount.toFixed(2)} SOL` : '';
          const txSignature = wallet.fundingDetails.signature || '';
          
          // Try to get source name from details or address categorization
          let sourceName = wallet.fundingDetails.sourceName;
          if (!sourceName) {
            try {
              const addressCategorization = require('../../utils/addressCategorization');
              const addressInfo = addressCategorization.getAddressInfo(wallet.funderAddress);
              sourceName = addressInfo ? addressInfo.name : null;
            } catch (error) {
              logger.debug('Error importing addressCategorization:', error);
            }
          }
          
          const timeAgo = wallet.fundingDetails.timestamp ? this.formatTimeDifference(wallet.fundingDetails.timestamp) : '';
          
          // Format the transaction link
          const txLink = txSignature ? 
            `<a href="https://solscan.io/tx/${txSignature}">funded</a>` : 
            'funded';
          
          let fundingInfo = '';
          
          if (fundingAmount && sourceName) {
            fundingInfo = `\n   └ ${txLink} ${fundingAmount} from <a href="https://solscan.io/account/${wallet.funderAddress}">${sourceName}</a> ${timeAgo}`;
          } else if (fundingAmount) {
            fundingInfo = `\n   └ ${txLink} ${fundingAmount} from <a href="https://solscan.io/account/${wallet.funderAddress}">${truncateAddress(wallet.funderAddress)}</a> ${timeAgo}`;
          }
          
          walletLine += fundingInfo;
        }
        
        message += `${walletLine}\n\n`;
      });

    return message;
  } catch (error) {
    logger.error(`Error in formatWalletDetails for ${walletType}:`, error);
    return `Error formatting ${walletType} details.`;
  }
}

/**
 * Format team supply analysis result
 * @param {Array} analyzedWallets - All analyzed wallets 
 * @param {Object} tokenInfo - Token information
 * @param {Array} teamWallets - Team wallets only
 * @param {number} totalSupplyControlled - Percentage of supply controlled by team wallets
 * @returns {string} Formatted team supply analysis
 */
formatTeamSupplyResult(analyzedWallets, tokenInfo, teamWallets, totalSupplyControlled) {
  try {
    let message = `<b>Team Supply Analysis for <a href="https://dexscreener.com/solana/${tokenInfo.address}">${tokenInfo.symbol}</a></b>\n\n`;

    message += `👥 Supply Controlled by team/insiders: ${formatNumber(totalSupplyControlled, 2, true)} ${this.getFreshWalletEmoji(totalSupplyControlled)}\n`;
    message += `⚠️ Wallets flagged as team/insiders: ${teamWallets.length}\n\n`;
    message += `<b>Top team wallets:</b>\n`;

    const topTeamWallets = analyzedWallets
      .filter(w => w.category !== 'Unknown')
      .sort((a, b) => new BigNumber(b.balance).minus(new BigNumber(a.balance)).toNumber())
      .slice(0, 10);

    topTeamWallets.forEach((wallet, index) => {
      const supplyPercentage = new BigNumber(wallet.balance)
        .dividedBy(tokenInfo.totalSupply)
        .multipliedBy(100)
        .toFixed(2);
        
      // Basic wallet info
      let walletLine = `${index + 1}. <a href="https://solscan.io/account/${wallet.address}">${truncateAddress(wallet.address)}</a> (${formatNumber(supplyPercentage, 2, true)}) - ${wallet.category}`;
      
      // Add funding info if available
      walletLine += this.formatFundingInfo(wallet.funderAddress, wallet.fundingDetails);
      
      message += `${walletLine}\n`;
    });

    return message;
  } catch (error) {
    logger.error('Error in formatTeamSupplyResult:', error);
    return 'Error formatting team supply details.';
  }
}

/**
 * Format team wallet details for detailed view
 * @param {Array} analyzedWallets - All analyzed wallets
 * @param {Object} tokenInfo - Token information
 * @returns {string} Formatted wallet details
 */
formatTeamWalletDetails(analyzedWallets, tokenInfo) {
  try {
    const teamWallets = analyzedWallets.filter(wallet => wallet.category !== 'Unknown');

    let message = `<b>${tokenInfo.symbol}</b> (<a href="https://dexscreener.com/solana/${tokenInfo.address}">📈</a>)\n`;
    message += `<b>${teamWallets.length} team addresses:</b>\n\n`;

    teamWallets
      .sort((a, b) => {
        const balanceA = new BigNumber(a.balance).dividedBy(tokenInfo.totalSupply).multipliedBy(100);
        const balanceB = new BigNumber(b.balance).dividedBy(tokenInfo.totalSupply).multipliedBy(100);
        return balanceB.minus(balanceA).toNumber();
      })
      .forEach((wallet, index) => {
        const percentage = new BigNumber(wallet.balance)
          .dividedBy(tokenInfo.totalSupply)
          .multipliedBy(100)
          .toFixed(2);

        // Basic wallet info
        let walletLine = `${index + 1}. <a href="https://solscan.io/account/${wallet.address}">${truncateAddress(wallet.address)}</a> (${percentage}%) - ${wallet.category}`;
        
        // Add funding info if available
        if (wallet.funderAddress && wallet.fundingDetails) {
          const fundingAmount = wallet.fundingDetails.amount ? `${wallet.fundingDetails.amount.toFixed(2)} SOL` : '';
          const txSignature = wallet.fundingDetails.signature || '';
          
          // Try to get source name from details or address categorization
          let sourceName = wallet.fundingDetails.sourceName;
          if (!sourceName) {
            try {
              const addressCategorization = require('../../utils/addressCategorization');
              const addressInfo = addressCategorization.getAddressInfo(wallet.funderAddress);
              sourceName = addressInfo ? addressInfo.name : null;
            } catch (error) {
              logger.debug('Error importing addressCategorization:', error);
            }
          }
          
          const timeAgo = wallet.fundingDetails.timestamp ? this.formatTimeDifference(wallet.fundingDetails.timestamp) : '';
          
          // Format the transaction link
          const txLink = txSignature ? 
            `<a href="https://solscan.io/tx/${txSignature}">funded</a>` : 
            'funded';
          
          let fundingInfo = '';
          
          if (fundingAmount && sourceName) {
            fundingInfo = `\n   └ ${txLink} ${fundingAmount} from <a href="https://solscan.io/account/${wallet.funderAddress}">${sourceName}</a> ${timeAgo}`;
          } else if (fundingAmount) {
            fundingInfo = `\n   └ ${txLink} ${fundingAmount} from <a href="https://solscan.io/account/${wallet.funderAddress}">${truncateAddress(wallet.funderAddress)}</a> ${timeAgo}`;
          }
          
          walletLine += fundingInfo;
        }
        
        message += `${walletLine}\n\n`;
      });

    return message;
  } catch (error) {
    logger.error('Error in formatTeamWalletDetails:', error);
    return 'Error formatting team wallet details.';
  }
}
  
  /**
   * Format the time difference between now and a past timestamp
   * @param {number} timestamp - Unix timestamp in seconds
   * @returns {string} - Formatted time difference (e.g., "2d ago")
   */
  formatTimeDifference(timestamp) {
    if (!timestamp) return '';
    
    const now = Math.floor(Date.now() / 1000);
    const seconds = now - timestamp;
    
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;
    if (seconds < 31536000) return `${Math.floor(seconds / 2592000)}mo ago`;
    return `${Math.floor(seconds / 31536000)}y ago`;
  }
}

module.exports = new UnifiedFormatter();