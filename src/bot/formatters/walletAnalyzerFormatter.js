const { formatNumber } = require('./generalFormatters');
const logger = require('../../utils/logger');

const getHoldingEmoji = (wallet) => {
  try {
    const totalValue = parseFloat(wallet.stats.totalValue);
    if (totalValue > 100000) return '🐳';
    if (totalValue > 50000) return '🦈';
    if (totalValue > 10000) return '🐬';
    if (totalValue > 1000) return '🐟';
    return '🦐';
  } catch (error) {
    logger.error('Error in getHoldingEmoji:', error);
    return '❓';
  }
};

const summarizeHolders = (categorizedWallets, tokenInfo) => {
  try {
    const summary = {
      '🐳 (> $100K)': 0,
      '🦈 ($50K - $100K)': 0,
      '🐬 ($10K - $50K)': 0,
      '🐟 ($1K - $10K)': 0,
      '🦐 ($0 - $1K)': 0
    };

    Object.values(categorizedWallets).flat().forEach(wallet => {
      const usdValue = wallet.stats.totalValue ? parseFloat(wallet.stats.totalValue) : (parseFloat(wallet.solBalance) * tokenInfo.solPrice);
      if (usdValue > 100000) summary['🐳 (> $100K)']++;
      else if (usdValue > 50000) summary['🦈 ($50K - $100K)']++;
      else if (usdValue > 10000) summary['🐬 ($10K - $50K)']++;
      else if (usdValue > 1000) summary['🐟 ($1K - $10K)']++;
      else summary['🦐 ($0 - $1K)']++;
    });

    return summary;
  } catch (error) {
    logger.error('Error in summarizeHolders:', error);
    return {};
  }
};

const formatSingleWallet = (wallet, index, tokenInfo) => {
  try {
    const rank = index + 1;
    const emoji = getHoldingEmoji(wallet);
    const shortAddress = `${wallet.address.substring(0, 6)}...${wallet.address.slice(-4)}`;
    
    let result = `${rank} - <a href="https://solscan.io/account/${wallet.address}">${shortAddress}</a> → (${wallet.supplyPercentage}%)\n`;
    
    result += `├ 💳 Sol: ${wallet.solBalance}\n`;

    // Ajouter les informations du wallet checker si elles sont disponibles
    if (wallet.winrate !== undefined && wallet.pnl30d !== undefined && wallet.unrealizedPnl !== undefined) {
      result += `├ 💰 P/L (30d): $${formatNumber(wallet.pnl30d)} 📈 uP/L: $${formatNumber(wallet.unrealizedPnl)}\n`;
      result += `├ 📊 Winrate (30d): ${wallet.winrate.toFixed(2)}%\n`;
    }

    result += `└ 💲 Port: $${formatNumber(parseFloat(wallet.stats.totalValue))}`;
  
    if (wallet.stats.tokenInfos && wallet.stats.tokenInfos.length > 0) {
      const topTokens = wallet.stats.tokenInfos
        .filter(token => token.symbol !== 'SOL' && token.symbol !== tokenInfo.symbol && parseFloat(token.value) >= 1000)
        .sort((a, b) => parseFloat(b.value) - parseFloat(a.value))
        .slice(0, 3);
  
      if (topTokens.length > 0) {
        result += ` (${topTokens.map(token => 
          `<a href="https://dexscreener.com/solana/${token.mint}?maker=${wallet.address}">${token.symbol}</a> $${formatNumber(parseFloat(token.value))}`
        ).join(', ')})`;
      }
    }
  
    return result + '\n\n';
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

const formatAnalysisMessage = (analysisResult, tokenInfo) => {

  logger.info(`Formatting early buyers message for ${tokenInfo.symbol}`);
  const messages = [];
  const errors = [];

  try {
    if (!Array.isArray(analysisResult)) {
      throw new Error('Invalid analysis result: expected an array');
    }

    // Catégoriser les portefeuilles
    const categorizedWallets = {
      'High Value': [],
      'Low Transactions': [],
      'Inactive': []
    };

    analysisResult.forEach(wallet => {
      if (wallet.category && categorizedWallets.hasOwnProperty(wallet.category)) {
        categorizedWallets[wallet.category].push(wallet);
      }
    });

    let totalWhaleWallets = categorizedWallets['High Value'].length;
    let totalWhaleSupplyPercentage = categorizedWallets['High Value'].reduce((sum, wallet) => sum + parseFloat(wallet.supplyPercentage), 0);
    let totalWhaleValue = categorizedWallets['High Value'].reduce((sum, wallet) => sum + parseFloat(wallet.tokenValueUsd), 0);

    let freshWallets = categorizedWallets['Low Transactions'].length;
    let freshWalletsSupplyPercentage = categorizedWallets['Low Transactions'].reduce((sum, wallet) => sum + parseFloat(wallet.supplyPercentage), 0);
    let freshWalletsValue = categorizedWallets['Low Transactions'].reduce((sum, wallet) => sum + parseFloat(wallet.tokenValueUsd), 0);

    let inactiveWallets = categorizedWallets['Inactive'].length;
    let inactiveWalletsSupplyPercentage = categorizedWallets['Inactive'].reduce((sum, wallet) => sum + parseFloat(wallet.supplyPercentage), 0);
    let inactiveWalletsValue = categorizedWallets['Inactive'].reduce((sum, wallet) => sum + parseFloat(wallet.tokenValueUsd), 0);

    let summaryMessage = `Analysis completed, interesting wallets found: ${analysisResult.length}\n\n`;
    summaryMessage += `🐳 ${totalWhaleWallets} whales wallets (calculated excluding ${tokenInfo.symbol}) (${totalWhaleSupplyPercentage.toFixed(2)}% worth $${formatNumber(totalWhaleValue)})\n`;
    summaryMessage += `🆕 ${freshWallets} fresh wallets (${freshWalletsSupplyPercentage.toFixed(2)}% worth $${formatNumber(freshWalletsValue)})\n`;
    summaryMessage += `💤 ${inactiveWallets} inactive wallets (${inactiveWalletsSupplyPercentage.toFixed(2)}% worth $${formatNumber(inactiveWalletsValue)})`;

    messages.push(summaryMessage);

    const whaleMessage = formatWhaleMap({categorizedWallets}, tokenInfo, 'High Value', '🐳 Whale Wallets');
    if (whaleMessage) {
      messages.push(whaleMessage);
    }

    const freshWalletMessage = formatFreshWalletMessage({categorizedWallets}, tokenInfo, '🆕 Fresh Wallets');
    if (freshWalletMessage) {
      messages.push(freshWalletMessage);
    }

    const inactiveWalletMessage = formatInactiveWalletMessage({categorizedWallets}, tokenInfo, '💤 Inactive Wallets');
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

module.exports = {
  formatNumber,
  formatWhaleMap,
  formatFreshWalletMessage,
  formatInactiveWalletMessage,
  formatAnalysisMessage,
  summarizeHolders,
  getHoldingEmoji,
  formatSingleWallet
};