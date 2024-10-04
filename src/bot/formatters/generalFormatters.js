

const formatNumber = (number, decimals = 1) => {
  if (number === undefined || number === null) {
    return '<code>N/A</code>';
  }

  const absNumber = Math.abs(number);
  let formattedNumber;

  if (absNumber >= 1e6) {
    formattedNumber = (number / 1e6).toFixed(decimals) + 'M';
  } else if (absNumber >= 1e3) {
    formattedNumber = (number / 1e3).toFixed(decimals) + 'k';
  } else {
    formattedNumber = Math.floor(number).toString(); 
  }

  formattedNumber = formattedNumber.replace(/\.0+([kM])?$/, '$1'); 
  return `<code>${formattedNumber}</code>`;
};


function escapeMarkdown(text) {
  const specialChars = ['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!'];
  return specialChars.reduce((acc, char) => acc.replace(new RegExp('\\' + char, 'g'), '\\' + char), text);
}
  
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
  
  module.exports = { formatNumber, formatAge, truncateAddress, getEmojiForPnl};