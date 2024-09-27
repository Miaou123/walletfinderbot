const { getAssetsForMultipleWallets } = require('../tools/walletValueCalculator');
const { formatNumber } = require('../bot/formatters/generalFormatters');
const { getHolders } = require('../tools/getHolders');

const searchWallets = async (coinAddress, searchCriteria, mainContext = 'default') => {
  try {
    const holders = await getHolders(coinAddress, mainContext, 'getHolders');
    const matchingWallets = [];

    holders.forEach(holder => {
      if (matchesCriteriaMultiple(holder.address, searchCriteria)) {
        matchingWallets.push(holder);
      }
    });

    const walletAddresses = matchingWallets.map(wallet => wallet.address);
    const assetsData = await getAssetsForMultipleWallets(walletAddresses, mainContext, 'getAssets');

    const formattedResults = matchingWallets.map((wallet, index) => 
      formatSingleWallet(wallet, index, assetsData[wallet.address], coinAddress)
    );

    return formattedResults.filter(result => result !== null);
  } catch (error) {
    console.error('Error in searchWallets:', error);
    throw error;
  }
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
      if (!assetData) {
        console.error(`No asset data found for wallet: ${wallet.address}`);
        return null;
      }
  
      const rank = index + 1;
      const shortAddress = `${wallet.address.substring(0, 6)}...${wallet.address.slice(-4)}`;
      
      let result = `${rank} - <a href="https://solscan.io/account/${wallet.address}">${shortAddress}</a>\n`;
      
      if (assetData.solBalance === undefined) {
        console.error(`SOL balance undefined for wallet: ${wallet.address}`);
        result += `├ 💳 Sol: Error fetching balance\n`;
      } else {
        result += `├ 💳 Sol: ${assetData.solBalance}\n`;
      }
  
      if (assetData.totalValue === undefined || isNaN(parseFloat(assetData.totalValue))) {
        console.error(`Invalid total value for wallet: ${wallet.address}`);
        result += `└ 💲 Port: Error calculating total value`;
      } else {
        result += `└ 💲 Port: $${formatNumber(parseFloat(assetData.totalValue))}`;
      }
    
      if (assetData.tokenInfos && Array.isArray(assetData.tokenInfos)) {
        const topTokens = assetData.tokenInfos
          .filter(token => token.symbol !== 'SOL' && !isNaN(parseFloat(token.value)) && parseFloat(token.value) >= 1000)
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
      console.error(`Error formatting wallet ${wallet.address}:`, error);
      return null;
    }
  };

module.exports = { searchWallets };