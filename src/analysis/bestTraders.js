const gmgnApi = require('../integrations/gmgnApi');
const { fetchMultipleWallets } = require('../tools/walletChecker');
const logger = require('../utils/logger'); 

const SORT_OPTIONS = {
  PNL: 'pnl',
  WINRATE: 'winrate',
  WR: 'wr',
  PORTFOLIO: 'portfolio',
  PORT: 'port',
  SOL: 'sol',
  RANK: 'rank'
};

function sortTraders(traders, sortOption) {
  const option = sortOption.toLowerCase();
  return traders.sort((a, b) => {
    // On accède directement aux données via data.data maintenant
    const aData = a.data.data;
    const bData = b.data.data;

    switch (option) {
      case SORT_OPTIONS.PNL:
        return bData.realized_profit_30d - aData.realized_profit_30d;
      case SORT_OPTIONS.WINRATE:
      case SORT_OPTIONS.WR:
        return bData.winrate - aData.winrate;
      case SORT_OPTIONS.PORTFOLIO:
      case SORT_OPTIONS.PORT:
        return bData.total_value - aData.total_value;
      case SORT_OPTIONS.SOL:
        // Convertir les balances de string en nombre pour la comparaison
        return parseFloat(bData.sol_balance) - parseFloat(aData.sol_balance);
      case SORT_OPTIONS.RANK:
        // Extraire les numéros de rank pour la comparaison
        const aRank = aData.wallet_tag_v2 ? parseInt(aData.wallet_tag_v2.replace('TOP', ''), 10) : Number.MAX_SAFE_INTEGER;
        const bRank = bData.wallet_tag_v2 ? parseInt(bData.wallet_tag_v2.replace('TOP', ''), 10) : Number.MAX_SAFE_INTEGER;
        // Trier par rang croissant (les petits numéros en premier)
        return aRank - bRank;
      default:
        return bData.winrate - aData.winrate;
    }
  });
}

async function analyzeBestTraders(contractAddress, winrateThreshold = 30, portfolioThreshold = 1000, sortOption = SORT_OPTIONS.WINRATE, mainContext = 'bestTraders') {
  try {
    // Récupérer les données des traders pour ce contrat
    const tradersData = await gmgnApi.getTopTraders(contractAddress, mainContext, 'analyzeBestTraders');
    const traders = tradersData.data;
    logger.info(`Fetched ${traders.length} top traders`);

    // Créer une map pour stocker les infos spécifiques au token pour chaque trader
    const tokenSpecificInfo = {};
    
    // Sauvegarder les informations spécifiques au token pour chaque trader
    traders.forEach(trader => {
      tokenSpecificInfo[trader.address] = {
        wallet_tag_v2: trader.wallet_tag_v2,  // Tag de classement (TOP43, etc.)
        profit_change: trader.profit_change   // Variation de profit en pourcentage (décimal)
      };
    });

    // Récupérer les adresses des traders
    const traderAddresses = traders.map(trader => trader.address);
    
    // Récupérer les informations détaillées sur les portefeuilles
    const walletData = await fetchMultipleWallets(traderAddresses, 10, mainContext, 'analyzeBestTraders');
    
    // Filtrer les traders selon les critères de winrate et portfolio
    const bestTraders = walletData.filter(wallet => {
      if (wallet?.data?.data) {
        const winrate = (wallet.data.data.winrate || 0) * 100; // Ajout d'un fallback pour éviter NaN
        const portfolioValue = wallet.data.data.total_value || 0; // Ajout d'un fallback pour éviter undefined
        return winrate > winrateThreshold && portfolioValue > portfolioThreshold;
      }
      return false;
    });

    // Ajouter les informations spécifiques au token à chaque trader
    bestTraders.forEach(trader => {
      if (trader.wallet && tokenSpecificInfo[trader.wallet]) {
        // Ajouter les informations spécifiques au token à la structure de données
        trader.data.data.wallet_tag_v2 = tokenSpecificInfo[trader.wallet].wallet_tag_v2;
        trader.data.data.profit_change = tokenSpecificInfo[trader.wallet].profit_change;
      }
    });

    // Trier les traders selon l'option de tri spécifiée
    const sortedTraders = sortTraders(bestTraders, sortOption);

    logger.info(`Found ${sortedTraders.length} traders with winrate > ${winrateThreshold}% and portfolio value > $${portfolioThreshold}, sorted by ${sortOption}`);

    return sortedTraders;
  } catch (error) {
    logger.error(`Error in analyzeBestTraders: ${error.message}`);
    throw error;
  }
}

module.exports = { analyzeBestTraders };