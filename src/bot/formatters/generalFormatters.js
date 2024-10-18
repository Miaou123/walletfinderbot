
const formatNumber = (number, decimals = 2, isPercentage = false) => {
  if (number === undefined || number === null) {
    return '<code>N/A</code>';
  }

  if (isPercentage) {
    return `<code>${number.toFixed(decimals)}%</code>`;
  }

  const absNumber = Math.abs(number);
  let formattedNumber;

  if (absNumber >= 1e6) {
    formattedNumber = (number / 1e6).toFixed(decimals) + 'M';
  } else if (absNumber >= 1e3) {
    formattedNumber = (number / 1e3).toFixed(decimals) + 'k';
  } else {
    formattedNumber = number.toFixed(decimals);
  }

  // Remove trailing zeros after the decimal point, but keep at least one decimal if there's a fractional part
  formattedNumber = formattedNumber.replace(/\.?0+$/, '');
  if (formattedNumber.includes('.') && !formattedNumber.includes('k') && !formattedNumber.includes('M')) {
    const parts = formattedNumber.split('.');
    if (parts[1].length < decimals) {
      formattedNumber = number.toFixed(decimals);
    }
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