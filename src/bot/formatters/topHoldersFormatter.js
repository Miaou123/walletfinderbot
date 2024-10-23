const { formatNumber, truncateAddress  } = require('./generalFormatters');
const logger = require('../../utils/logger');

const formatAnalysisMessage = (analysisResult, tokenInfo) => {
  logger.info(`Formatting early buyers message for ${tokenInfo.symbol}`);
  const messages = [];
  const errors = [];

  try {
    let analyzedWallets;
    
    // Check the structure of analysisResult
    if (Array.isArray(analysisResult)) {
      analyzedWallets = analysisResult;
    } else if (analysisResult && Array.isArray(analysisResult.analyzedWallets)) {
      analyzedWallets = analysisResult.analyzedWallets;
    } else if (analysisResult && typeof analysisResult === 'object') {
      // If it's an object, we'll try to extract the wallets
      analyzedWallets = Object.values(analysisResult).flat().filter(Array.isArray);
    } else {
      throw new Error('Invalid analysis result: unable to find analyzed wallets');
    }

    // Catégoriser les portefeuilles
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

    let totalWhaleWallets = categorizedWallets['High Value'].length;
    let totalWhaleSupplyPercentage = categorizedWallets['High Value'].reduce((sum, wallet) => sum + parseFloat(wallet.supplyPercentage || 0), 0);
    let totalWhaleValue = categorizedWallets['High Value'].reduce((sum, wallet) => sum + parseFloat(wallet.tokenValueUsd || 0), 0);

    let freshWallets = categorizedWallets['Low Transactions'].length;
    let freshWalletsSupplyPercentage = categorizedWallets['Low Transactions'].reduce((sum, wallet) => sum + parseFloat(wallet.supplyPercentage || 0), 0);
    let freshWalletsValue = categorizedWallets['Low Transactions'].reduce((sum, wallet) => sum + parseFloat(wallet.tokenValueUsd || 0), 0);

    let inactiveWallets = categorizedWallets['Inactive'].length;
    let inactiveWalletsSupplyPercentage = categorizedWallets['Inactive'].reduce((sum, wallet) => sum + parseFloat(wallet.supplyPercentage || 0), 0);
    let inactiveWalletsValue = categorizedWallets['Inactive'].reduce((sum, wallet) => sum + parseFloat(wallet.tokenValueUsd || 0), 0);

    let summaryMessage = `<b><a href="https://solscan.io/token/${tokenInfo.address}">${tokenInfo.name}</a></b> (${tokenInfo.symbol}) `;
    summaryMessage += `<a href="https://dexscreener.com/solana/${tokenInfo.address}">📈</a>\n`;
    summaryMessage += `<code>${tokenInfo.address}</code>\n\n`;

    summaryMessage += `🐳 ${totalWhaleWallets} whales wallets (calculated excluding ${tokenInfo.symbol}) (${totalWhaleSupplyPercentage.toFixed(2)}% worth $${formatNumber(totalWhaleValue)})\n`;
    summaryMessage += `🆕 ${freshWallets} fresh wallets (${freshWalletsSupplyPercentage.toFixed(2)}% worth $${formatNumber(freshWalletsValue)})\n`;
    summaryMessage += `💤 ${inactiveWallets} inactive wallets (${inactiveWalletsSupplyPercentage.toFixed(2)}% worth $${formatNumber(inactiveWalletsValue)})`;

    messages.push(summaryMessage);

    const whaleMessage = formatWhaleMap({categorizedWallets}, tokenInfo, 'High Value', '🐳 Whale Wallets');
    if (whaleMessage) {
      messages.push(whaleMessage);
    }

    const freshWalletMessage = formatFreshWalletMessage({categorizedWallets}, tokenInfo);
    if (freshWalletMessage) {
      messages.push(freshWalletMessage);
    }

    const inactiveWalletMessage = formatInactiveWalletMessage({categorizedWallets}, tokenInfo);
    if (inactiveWalletMessage) {
      messages.push(inactiveWalletMessage);
    }

  } catch (error) {
    logger.error('Error in formatAnalysisMessage:', error);
    errors.push(`Error in analysis formatting: ${error.message}`);
    messages.push('An error occurred while formatting the analysis results.');
  }

  return { messages, errors };
};

const formatSingleWallet = (wallet, index, tokenInfo) => {
  try {
    const rank = index + 1;
    const portfolioValue = parseFloat(wallet.stats.totalValue);
    
    // 1. Ligne principale avec adresse, pourcentage et liens
    let info = `${rank}. ${truncateAddress(wallet.address)} → ${formatNumber(wallet.supplyPercentage, 2, true)} ` +
               `<a href="https://gmgn.ai/sol/address/${wallet.address}">gmgn</a>/` +
               `<a href="https://app.cielo.finance/profile/${wallet.address}/pnl/tokens">cielo</a>\n`;

    // 2. Portfolio et SOL
    info += `├ 💼 Port: ${formatNumber(portfolioValue)} (SOL: ${formatNumber(wallet.solBalance, 2)})\n`;

    // 3. P/L et unrealized P/L si disponible
    if (wallet.pnl30d !== undefined && wallet.unrealizedPnl !== undefined) {
      info += `├ 💰 P/L (30d): ${formatNumber(wallet.pnl30d)} 📈 uP/L: ${formatNumber(wallet.unrealizedPnl)}\n`;
    }

    // 4. Winrate si disponible
    if (wallet.winrate !== undefined) {
      info += `└ 📊 Winrate (30d): ${formatNumber(wallet.winrate, 2, true)}`;
    } else {
      info += `└ 💼 Port: ${formatNumber(portfolioValue)}`;
    }
  
    // 5. Ajouter les top tokens si disponibles
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

const formatWhaleMap = (analysisResult, tokenInfo, category, title) => {
  try {
    if (!analysisResult || !analysisResult.categorizedWallets) {
      logger.error('Invalid analysis result in formatWhaleMap:', analysisResult);
      return null;
    }

    const wallets = analysisResult.categorizedWallets[category] || [];
    if (wallets.length === 0) {
      logger.log(`No wallets found for category: ${category}`);
      return null;
    }

    wallets.sort((a, b) => parseFloat(b.stats.totalValue) - parseFloat(a.stats.totalValue));

    let message = `${title} for <a href="https://solscan.io/token/${tokenInfo.address}">${tokenInfo.symbol}</a>\n\n`;

    wallets.forEach((wallet, index) => {
      message += formatSingleWallet(wallet, index, tokenInfo);
    });

    return message;
  } catch (error) {
    logger.error(`Error in formatWhaleMap for category ${category}:`, error);
    return null;
  }
};

const formatFreshWalletMessage = (analysisResult, tokenInfo) => {
  try {
    const freshWallets = analysisResult.categorizedWallets['Low Transactions'] || [];

    if (freshWallets.length === 0) return null;

    let message = `🆕Fresh Wallets for <a href="https://solscan.io/token/${tokenInfo.address}">${tokenInfo.symbol}</a>\n\n`;

    freshWallets.forEach((wallet, index) => {
      message += formatSimpleWallet(wallet, index, tokenInfo);
    });

    return message;
  } catch (error) {
    logger.error('Error in formatFreshWalletMessage:', error);
    return null;
  }
};



const formatInactiveWalletMessage = (analysisResult, tokenInfo) => {
  try {
    const inactiveWallets = analysisResult.categorizedWallets['Inactive'] || [];

    if (inactiveWallets.length === 0) return null;

    let message = `💤 Inactive Wallets for <a href="https://solscan.io/token/${tokenInfo.address}">${tokenInfo.symbol}</a>\n\n`;

    inactiveWallets.forEach((wallet, index) => {
      message += formatSimpleWallet(wallet, index, tokenInfo);
      message += `Last swap: ${Math.floor(wallet.daysSinceLastRelevantSwap)}d ago\n\n`;
    });

    return message;
  } catch (error) {
    logger.error('Error in formatInactiveWalletMessage:', error);
    return null;
  }
};



module.exports = {
  formatNumber,
  formatWhaleMap,
  formatFreshWalletMessage,
  formatInactiveWalletMessage,
  formatAnalysisMessage,
  formatSingleWallet
};