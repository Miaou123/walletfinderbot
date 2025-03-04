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
  RANK: 'rank',
  TOTALPNL: 'totalpnl'  // Nouvelle option de tri
};

/**
 * Calcule le PnL total (réalisé + non réalisé) en pourcentage
 * @param {Object} traderData - Données du trader
 * @returns {number} - Pourcentage de PnL total ou 0 si indisponible
 */
function calculateTotalPnL(traderData) {
  // Récupération des profits réalisés et non réalisés
  const realizedProfit = traderData.realized_profit || 0;
  const unrealizedProfit = traderData.unrealized_profit || 0;
  
  // Coût total d'achat
  const totalCost = traderData.buy_volume_cur || 0;
  
  // Éviter la division par zéro
  if (totalCost === 0 || totalCost === null) {
    return 0;
  }
  
  // Calcul du PnL total en pourcentage
  const totalPnLPercent = ((realizedProfit + unrealizedProfit) / totalCost) * 100;
  
  return totalPnLPercent;
}

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
      case SORT_OPTIONS.TOTALPNL:
        // Trier par PnL total décroissant
        return bData.total_pnl_percent - aData.total_pnl_percent;
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
        wallet_tag_v2: trader.wallet_tag_v2,                // Tag de classement (TOP43, etc.)
        profit_change: trader.profit_change,                // Variation de profit en pourcentage (décimal)
        realized_profit: trader.realized_profit || 0,       // Profit réalisé
        unrealized_profit: trader.unrealized_profit || 0,   // Profit non réalisé
        buy_volume_cur: trader.buy_volume_cur || 0,         // Volume d'achat total
        profit: trader.profit || 0                          // Profit total
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
        const tokenInfo = tokenSpecificInfo[trader.wallet];
        
        // Ajouter les informations spécifiques au token à la structure de données
        trader.data.data.wallet_tag_v2 = tokenInfo.wallet_tag_v2;
        trader.data.data.profit_change = tokenInfo.profit_change;
        trader.data.data.token_realized_profit = tokenInfo.realized_profit;
        trader.data.data.token_unrealized_profit = tokenInfo.unrealized_profit;
        trader.data.data.token_buy_volume = tokenInfo.buy_volume_cur;
        trader.data.data.token_profit = tokenInfo.profit;
        
        // Calculer le PnL total en pourcentage
        if (tokenInfo.buy_volume_cur > 0) {
          const totalProfit = tokenInfo.realized_profit + tokenInfo.unrealized_profit;
          const totalPnLPercent = (totalProfit / tokenInfo.buy_volume_cur) * 100;
          trader.data.data.total_pnl_percent = totalPnLPercent;
        } else {
          trader.data.data.total_pnl_percent = 0;
        }
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