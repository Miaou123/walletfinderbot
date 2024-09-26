const { getSolanaApi } = require('../integrations/solanaApi');
const { getAssetsForMultipleWallets } = require('../tools/walletValueCalculator');
const { formatNumber } = require('../bot/formatters/generalFormatters');
const { getHolders } = require('../tools/getHolders');

const searchWallets = async (coinAddress, searchCriteria) => {
    
  const holders = await getHolders(coinAddress);
  const matchingWallets = [];

  holders.forEach(holder => {
    if (matchesCriteriaMultiple(holder.address, searchCriteria)) {
      matchingWallets.push(holder);
    }
  });

  // Récupérer les informations détaillées des portefeuilles correspondants
  const walletAddresses = matchingWallets.map(wallet => wallet.address);
  const assetsData = await getAssetsForMultipleWallets(walletAddresses);

  // Formater les résultats
  const formattedResults = matchingWallets.map((wallet, index) => 
    formatSingleWallet(wallet, index, assetsData[wallet.address], coinAddress)
  );

  return formattedResults;
};

const matchesCriteriaMultiple = (address, criteria) => {
  return criteria.some(criterion => matchesCriteria(address, criterion));
};

const matchesCriteria = (address, criterion) => {
  const patterns = criterion.split(/\.+/); // Split on one or more dots
  return patterns.every(pattern => address.includes(pattern));
};

const formatSingleWallet = (wallet, index, assetData, coinAddress) => {
  try {
    const rank = index + 1;
    const shortAddress = `${wallet.address.substring(0, 6)}...${wallet.address.slice(-4)}`;
    
    let result = `${rank} - <a href="https://solscan.io/account/${wallet.address}">${shortAddress}</a>\n`;
    
    result += `├ 💳 Sol: ${assetData.solBalance}\n`;
    result += `└ 💲 Port: $${formatNumber(parseFloat(assetData.totalValue))}`;
  
    if (assetData.tokenInfos && assetData.tokenInfos.length > 0) {
      const topTokens = assetData.tokenInfos
        .filter(token => token.symbol !== 'SOL' && parseFloat(token.value) >= 1000)
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
    console.error('Error in formatSingleWallet:', error);
    return '';
  }
};

module.exports = { searchWallets };