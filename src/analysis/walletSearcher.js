const { getAssetsForMultipleWallets } = require('../tools/walletValueCalculator');
const { formatNumber } = require('../bot/formatters/generalFormatters');
const { getHolders } = require('../tools/getHolders');
const logger = require('../utils/logger'); 

/**
 * Recherche des portefeuilles en fonction de l'adresse du token et des critères de recherche.
 * @param {string} coinAddress - Adresse du token à analyser.
 * @param {Array<string>} searchCriteria - Critères de recherche pour filtrer les portefeuilles.
 * @param {string} mainContext - Contexte principal pour l'analyse.
 * @returns {Promise<Array>} - Liste formatée des résultats correspondant aux critères.
 */
const searchWallets = async (coinAddress, searchCriteria, mainContext = 'default') => {
  try {
    const holders = await getHolders(coinAddress, mainContext, 'getHolders');

    const matchingWallets = holders.filter(holder => matchesCriteriaMultiple(holder.address, searchCriteria));

    const walletAddresses = matchingWallets.map(wallet => wallet.address);
    const assetsData = await getAssetsForMultipleWallets(walletAddresses, mainContext, 'getAssets');
    
    const formattedResults = matchingWallets.map((wallet, index) =>
      formatSingleWallet(wallet, index, assetsData[wallet.address], coinAddress)
    );

    const validResults = formattedResults.filter(result => result !== null);
    return validResults;

  } catch (error) {
    logger.error(`Error during wallet search for token: ${coinAddress}`, { context: mainContext, error });
    throw error;
  }
};

/**
 * Vérifie si un portefeuille correspond à plusieurs critères.
 * @param {string} address - Adresse du portefeuille à vérifier.
 * @param {Array<string>} criteria - Liste des critères.
 * @returns {boolean} - Vrai si l'adresse correspond à au moins un des critères.
 */
const matchesCriteriaMultiple = (address, criteria) => {
  return criteria.some(criterion => matchesCriteria(address, criterion));
};

/**
 * Vérifie si un portefeuille correspond à un critère spécifique.
 * @param {string} address - Adresse du portefeuille à vérifier.
 * @param {string} criterion - Critère à vérifier.
 * @returns {boolean} - Vrai si l'adresse correspond au critère.
 */
const matchesCriteria = (address, criterion) => {
  const patterns = criterion.split(/\.+/); // Split on one or more dots
  return patterns.every(pattern => address.includes(pattern));
};

/**
 * Formate un portefeuille pour l'affichage.
 * @param {Object} wallet - Informations du portefeuille.
 * @param {number} index - Position dans le classement.
 * @param {Object} assetData - Données d'actifs pour le portefeuille.
 * @param {string} coinAddress - Adresse du token.
 * @returns {string|null} - Chaîne formatée ou null en cas d'erreur.
 */
const formatSingleWallet = (wallet, index, assetData, coinAddress) => {
  try {
    if (!assetData) {
      logger.warn(`No asset data found for wallet: ${wallet.address}`, { wallet: wallet.address });
      return null;
    }

    const rank = index + 1;
    const shortAddress = `${wallet.address.substring(0, 6)}...${wallet.address.slice(-4)}`;

    let result = `${rank} - <a href="https://solscan.io/account/${wallet.address}">${shortAddress}</a>\n`;

    result += assetData.solBalance !== undefined
      ? `├ 💳 Sol: ${assetData.solBalance}\n`
      : `├ 💳 Sol: Error fetching balance\n`;

    result += assetData.totalValue !== undefined && !isNaN(parseFloat(assetData.totalValue))
      ? `└ 💲 Port: $${formatNumber(parseFloat(assetData.totalValue))}`
      : `└ 💲 Port: Error calculating total value`;

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
    logger.error(`Error formatting wallet ${wallet.address}`, { error, wallet: wallet.address });
    return null;
  }
};

module.exports = { searchWallets };
