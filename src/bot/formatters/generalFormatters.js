const formatNumber = (number, decimals = 1, isPercentage = false) => {
  if (number === undefined || number === null) {
    return '<code>N/A</code>';
  }

  // Convertir en nombre si ce n'est pas déjà le cas
  number = Number(number);

  if (isNaN(number)) {
    return '<code>N/A</code>';
  }

  const absNumber = Math.abs(number);
  let formattedNumber;

  if (isPercentage) {
    formattedNumber = number.toFixed(2) + '%';
  } else if (absNumber >= 1e6) {
    formattedNumber = (number / 1e6).toFixed(decimals) + 'M';
  } else if (absNumber >= 1e3) {
    formattedNumber = (number / 1e3).toFixed(decimals) + 'k';
  } else if (absNumber >= 1) {
    formattedNumber = number.toFixed(decimals);
  } else if (absNumber > 0) {
    // Gérer les nombres entre 0 et 1
    formattedNumber = number.toFixed(decimals);
  } else {
    // Gérer le cas où le nombre est exactement 0
    formattedNumber = '0';
  }

  if (formattedNumber) {
    formattedNumber = formattedNumber.replace(/\.0+([kM%])?$/, '$1');
  }

  return `<code>${formattedNumber}</code>`;
};

  
  const formatAge = (pairCreatedAt) => {
    if (!pairCreatedAt) return 'N/A';
    const ageInMinutes = (Date.now() - pairCreatedAt) / (1000 * 60);
    if (ageInMinutes < 60) {
      return `${Math.round(ageInMinutes)}m`;
    } else if (ageInMinutes < 1440) {
      return `${Math.round(ageInMinutes / 60)}h`;
    } else if (ageInMinutes < 43200) {
      return `${Math.round(ageInMinutes / 1440)}d`;
    } else {
      return `${Math.round(ageInMinutes / 43200)}mo`;
    }
  };

function truncateAddress(address, start = 5, end = 4) {
    return `${address.slice(0, start)}...${address.slice(-end)}`;
}

function getEmojiForPnl(totalValue) {
  if (totalValue > 100000) return '🐳';
  if (totalValue > 50000) return '🦈';
  if (totalValue > 10000) return '🐬';
  if (totalValue > 1000) return '🐟';
    return '🦐'; 
}

const summarizeHolders = (categorizedWallets, tokenInfo) => {
  const summary = {
    '🐳 (> $100K)': 0,
    '🦈 ($50K - $100K)': 0,
    '🐬 ($10K - $50K)': 0,
    '🐟 ($1K - $10K)': 0,
    '🦐 ($0 - $1K)': 0
  };
  try {
    Object.values(categorizedWallets).flat().forEach(wallet => {
      const usdValue = parseFloat(wallet.stats.totalValue) || (parseFloat(wallet.solBalance) * tokenInfo.solPrice);
      if (usdValue > 100000) summary['🐳 (> $100K)']++;
      else if (usdValue > 50000) summary['🦈 ($50K - $100K)']++;
      else if (usdValue > 10000) summary['🐬 ($10K - $50K)']++;
      else if (usdValue > 1000) summary['🐟 ($1K - $10K)']++;
      else summary['🦐 ($0 - $1K)']++;
    });
  } catch (error) {
    logger.error('Error in summarizeHolders:', error);
  }

  return summary;
};
  
  module.exports = { formatNumber, formatAge, truncateAddress, getEmojiForPnl, summarizeHolders};