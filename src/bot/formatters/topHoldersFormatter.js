const { formatNumber, truncateAddress  } = require('./generalFormatters');
const logger = require('../../utils/logger');

const formatAnalysisMessage = (analysisResult, tokenInfo) => {
  logger.info(`Formatting early buyers message for ${tokenInfo.symbol}`);
  let finalMessage = '';
  const errors = [];

  try {
    let analyzedWallets;
    
    if (Array.isArray(analysisResult)) {
      analyzedWallets = analysisResult;
    } else if (analysisResult && Array.isArray(analysisResult.analyzedWallets)) {
      analyzedWallets = analysisResult.analyzedWallets;
    } else if (analysisResult && typeof analysisResult === 'object') {
      analyzedWallets = Object.values(analysisResult).flat().filter(Array.isArray);
    } else {
      throw new Error('Invalid analysis result: unable to find analyzed wallets');
    }

    const categorizedWallets = {
      'High Value': [],
      'Low Transactions': [],
      'Inactive': []
    };

    analyzedWallets.forEach(wallet => {
      if (wallet.category && categorizedWallets.hasOwnProperty(wallet.category)) {
        categorizedWallets[wallet.category].push(wallet);
      }
    });

    // Summary section
    let totalWhaleWallets = categorizedWallets['High Value'].length;
    let totalWhaleSupplyPercentage = categorizedWallets['High Value'].reduce((sum, wallet) => sum + parseFloat(wallet.supplyPercentage || 0), 0);
    let totalWhaleValue = categorizedWallets['High Value'].reduce((sum, wallet) => sum + parseFloat(wallet.tokenValueUsd || 0), 0);

    let freshWallets = categorizedWallets['Low Transactions'].length;
    let freshWalletsSupplyPercentage = categorizedWallets['Low Transactions'].reduce((sum, wallet) => sum + parseFloat(wallet.supplyPercentage || 0), 0);
    let freshWalletsValue = categorizedWallets['Low Transactions'].reduce((sum, wallet) => sum + parseFloat(wallet.tokenValueUsd || 0), 0);

    let inactiveWallets = categorizedWallets['Inactive'].length;
    let inactiveWalletsSupplyPercentage = categorizedWallets['Inactive'].reduce((sum, wallet) => sum + parseFloat(wallet.supplyPercentage || 0), 0);
    let inactiveWalletsValue = categorizedWallets['Inactive'].reduce((sum, wallet) => sum + parseFloat(wallet.tokenValueUsd || 0), 0);

    // Build the combined message
    finalMessage = `<b><a href="https://solscan.io/token/${tokenInfo.address}">${tokenInfo.name}</a></b> (${tokenInfo.symbol}) `;
    finalMessage += `<a href="https://dexscreener.com/solana/${tokenInfo.address}">📈</a>\n`;
    finalMessage += `<code>${tokenInfo.address}</code>\n\n`;

    finalMessage += `🐳 ${totalWhaleWallets} whales wallets (calculated excluding ${tokenInfo.symbol}) (${totalWhaleSupplyPercentage.toFixed(2)}% worth $${formatNumber(totalWhaleValue)})\n`;
    finalMessage += `🆕 ${freshWallets} fresh wallets (${freshWalletsSupplyPercentage.toFixed(2)}% worth $${formatNumber(freshWalletsValue)})\n`;
    finalMessage += `💤 ${inactiveWallets} inactive wallets (${inactiveWalletsSupplyPercentage.toFixed(2)}% worth $${formatNumber(inactiveWalletsValue)})\n\n`;

    // Add Whale Wallets section
    if (categorizedWallets['High Value'].length > 0) {
      finalMessage += `🐳 Whale Wallets for <a href="https://solscan.io/token/${tokenInfo.address}">${tokenInfo.symbol}</a>\n\n`;
      categorizedWallets['High Value']
        .sort((a, b) => parseFloat(b.stats.totalValue) - parseFloat(a.stats.totalValue))
        .forEach((wallet, index) => {
          finalMessage += formatSingleWallet(wallet, index, tokenInfo);
        });
    }

    // Add Fresh Wallets section
    if (categorizedWallets['Low Transactions'].length > 0) {
      finalMessage += `🆕 Fresh Wallets for <a href="https://solscan.io/token/${tokenInfo.address}">${tokenInfo.symbol}</a>\n\n`;
      categorizedWallets['Low Transactions'].forEach((wallet, index) => {
        finalMessage += formatSimpleWallet(wallet, index, tokenInfo);
      });
    }

    // Add Inactive Wallets section
    if (categorizedWallets['Inactive'].length > 0) {
      finalMessage += `💤 Inactive Wallets for <a href="https://solscan.io/token/${tokenInfo.address}">${tokenInfo.symbol}</a>\n\n`;
      categorizedWallets['Inactive'].forEach((wallet, index) => {
        finalMessage += formatSimpleWallet(wallet, index, tokenInfo);
        finalMessage += `Last swap: ${Math.floor(wallet.daysSinceLastRelevantSwap)}d ago\n\n`;
      });
    }

  } catch (error) {
    logger.error('Error in formatAnalysisMessage:', error);
    errors.push(`Error in analysis formatting: ${error.message}`);
    finalMessage = 'An error occurred while formatting the analysis results.';
  }

  // Retourner un tableau avec un seul message pour maintenir la compatibilité
  return { messages: [finalMessage], errors };
};

// Keep the existing helper functions unchanged
const formatSingleWallet = (wallet, index, tokenInfo) => {
  try {
    const rank = index + 1;
    const portfolioValue = parseFloat(wallet.stats.totalValue);
    
    let info = `${rank}.  <a href="https://solscan.io/account/${wallet.address}">${truncateAddress(wallet.address)}</a> → ${formatNumber(wallet.supplyPercentage, 2, true)} ` +
               `<a href="https://gmgn.ai/sol/address/${wallet.address}">gmgn</a>/` +
               `<a href="https://app.cielo.finance/profile/${wallet.address}/pnl/tokens">cielo</a>\n`;

    info += `├ 💼 Port: ${formatNumber(portfolioValue)} (SOL: ${formatNumber(wallet.solBalance, 2)})\n`;

    if (wallet.pnl30d !== undefined && wallet.unrealizedPnl !== undefined) {
      info += `├ 💰 P/L (30d): ${formatNumber(wallet.pnl30d)} 📈 uP/L: ${formatNumber(wallet.unrealizedPnl)}\n`;
    }

    if (wallet.winrate !== undefined) {
      info += `└ 📊 Winrate (30d): ${formatNumber(wallet.winrate, 2, true)}`;
    } else {
      info += `└ 💼 Port: ${formatNumber(portfolioValue)}`;
    }
  
    if (wallet.stats.tokenInfos && wallet.stats.tokenInfos.length > 0) {
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
  
    return info + '\n\n';
  } catch (error) {
    logger.error('Error in formatSingleWallet:', error);
    return '';
  }
};

const formatSimpleWallet = (wallet, index) => {
  try {
    const rank = index + 1;
    const shortAddress = `${wallet.address.substring(0, 6)}...${wallet.address.slice(-4)}`;
    return `${rank} - <a href="https://solscan.io/account/${wallet.address}">${shortAddress}</a> → (${wallet.supplyPercentage}%)\n`;
  } catch (error) {
    logger.error('Error in formatSimpleWallet:', error);
    return '';
  }
};

module.exports = {
  formatNumber,
  formatAnalysisMessage,
  formatSingleWallet
};