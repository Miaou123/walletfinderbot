const { getSolanaApi } = require('../integrations/solanaApi');
const { getDexScreenerApi } = require('../integrations/dexscreenerApi');
const { getAssetsForMultipleWallets } = require('../tools/walletValueCalculator');
const { checkInactivityPeriod } = require('../tools/inactivityPeriod');
const { getHolders, getTopHolders } = require('../tools/getHolders');
const config = require('../utils/config');
const BigNumber = require('bignumber.js');

async function scanToken(tokenAddress, requestedHolders = 10, trackSupply = false, mainContext = 'default') {
  console.log(`Scanning token: ${tokenAddress}, requested holders: ${requestedHolders}, context: ${mainContext}`);

  const dexScreenerApi = getDexScreenerApi();

  // 1. Récupérer les informations du token
  const tokenInfo = await dexScreenerApi.getTokenInfo(tokenAddress, mainContext);

  // Afficher les informations du token de manière structurée
  console.log('Token Information:');
  console.log(JSON.stringify(tokenInfo, null, 2));
  

  // 2. Récupérer les détenteurs (au moins 20 ou le nombre demandé si supérieur)
  const holdersToFetch = Math.max(20, requestedHolders);
  console.log(`Fetching top ${holdersToFetch} holders`);
  const topHolders = await getTopHolders(tokenAddress, holdersToFetch, mainContext, 'getTopHolders');
  console.log(`Received ${topHolders.length} top holders`);

  // 3. Analyser les portefeuilles
  const walletAddresses = topHolders.map(holder => holder.address);
  const assetsData = await getAssetsForMultipleWallets(walletAddresses, mainContext, 'getAssets');

  // 4. Analyser chaque portefeuille
  const analyzedWallets = await Promise.all(topHolders.map(async (holder, index) => {
    try {
      const walletData = assetsData[holder.address] || {};
      const decimals = tokenInfo.decimals;
      const totalSupply = new BigNumber(tokenInfo.totalSupply || 0);
      const tokenBalanceRaw = new BigNumber(holder.tokenBalance || 0);
      const tokenBalance = tokenBalanceRaw.dividedBy(new BigNumber(10).pow(decimals));
      const supplyPercentage = totalSupply.isGreaterThan(0) ? 
        tokenBalance.dividedBy(totalSupply).multipliedBy(100).toFixed(2) : '0';
    

      // Trouver le token analysé dans les données du portefeuille
      const analyzedTokenInfo = walletData.tokenInfos && walletData.tokenInfos.find(t => t.mint === tokenAddress) || {};
      const tokenValue = new BigNumber(analyzedTokenInfo.value || 0);

      const totalValue = new BigNumber(walletData.totalValue || 0);
      const portfolioValueWithoutToken = totalValue.minus(tokenValue);

      let isInteresting = false;
      let category = '';

      // Check if it's a high value wallet (whale)
      if (portfolioValueWithoutToken.isGreaterThan(config.HIGH_WALLET_VALUE_THRESHOLD)) {
        isInteresting = true;
        category = 'High Value';
      } else {
        // Check if it's a fresh wallet
        const solanaApi = getSolanaApi();
        const transactions = await solanaApi.getSignaturesForAddress(holder.address, { limit: config.LOW_TRANSACTION_THRESHOLD + 1 }, mainContext);
        const transactionCount = transactions.length;

        if (transactionCount < config.LOW_TRANSACTION_THRESHOLD) {
          isInteresting = true;
          category = 'Fresh Address';
        } else {
            // Check inactivity period
            const inactivityCheck = await checkInactivityPeriod(holder.address, tokenAddress, mainContext, 'checkInactivity');
          if (inactivityCheck.isInactive) {
            isInteresting = true;
            category = 'Inactive';
          }
        }
      }

      return {
        rank: index + 1,
        address: holder.address,
        supplyPercentage,
        solBalance: walletData.solBalance || '0',
        portfolioValue: walletData.totalValue || '0',
        portfolioValueWithoutToken: portfolioValueWithoutToken.toFixed(2),
        isInteresting,
        category,
        tokenBalance: tokenBalance.toFormat(0),
        tokenValue: tokenValue.toFixed(2),
        tokenInfos: walletData.tokenInfos || []
      };
    } catch (error) {
      console.error(`Error analyzing wallet ${holder.address}:`, error);
      return {
        rank: index + 1,
        address: holder.address,
        error: 'Failed to analyze'
      };
    }
  }));

  // 5. Filtrer les wallets
  const filteredWallets = analyzedWallets.filter(wallet => {
    if (wallet.error) return false;
    const isNotPoolOrBot = !wallet.isPool && !wallet.isBot;
    const hasValidValue = new BigNumber(wallet.portfolioValue).isGreaterThan(0);
    return isNotPoolOrBot && hasValidValue;
  });
  console.log(`Filtered wallets: ${filteredWallets.length}`);

  // 6. Prendre le nombre demandé de portefeuilles ou tous si moins que demandé
  const finalWallets = filteredWallets.slice(0, requestedHolders);
  console.log(`Final number of wallets to display: ${finalWallets.length}`);

  // 7. Calculer les statistiques globales
  const totalSupplyControlled = finalWallets.reduce((sum, wallet) => sum + parseFloat(wallet.supplyPercentage || 0), 0);
  const averagePortfolioValue = finalWallets.length > 0 
    ? finalWallets.reduce((sum, wallet) => sum + parseFloat(wallet.portfolioValue || 0), 0) / finalWallets.length
    : 0;
  const notableAddresses = finalWallets.filter(wallet => wallet.isInteresting).length;

  // 8. Formater le résultat
  const result = formatScanResult(tokenInfo, finalWallets, totalSupplyControlled, averagePortfolioValue, notableAddresses, tokenAddress);

  // 9. Si le tracking est demandé, retourner les informations nécessaires
  if (trackSupply) {
    return {
      formattedResult: result,
      trackingInfo: {
        tokenAddress,
        tokenSymbol: tokenInfo.symbol,
        totalSupplyControlled,
        totalSupply: tokenInfo.totalSupply,
        decimals: tokenInfo.decimals,
        topHoldersWallets: finalWallets.map(wallet => ({
          address: wallet.address,
          percentage: parseFloat(wallet.supplyPercentage)
        }))
      }
    };
  }  

  return result;
}

function formatScanResult(tokenInfo, finalWallets, totalSupplyControlled, averagePortfolioValue, notableAddresses, tokenAddress) {
  let result = `<b><a href="https://solscan.io/token/${tokenAddress}">${(tokenInfo.name)}</a></b> (${(tokenInfo.symbol)}) `;
  result += `<a href="https://dexscreener.com/solana/${tokenAddress}">📈</a>\n`;
  result += `<code>${(tokenAddress)}</code>\n\n`;

  if (finalWallets.length === 0) {
    result += "<strong>No valid holders found after filtering.</strong>\n";
    return result;
  }

  result += `<strong>Top ${finalWallets.length} holders analysis (excluding liquidity pools and bots):</strong>\n`;
  result += `👥 Supply Controlled: ${totalSupplyControlled.toFixed(2)}%\n`;
  result += `💰 Average portfolio Value: $${(averagePortfolioValue / 1000).toFixed(2)}K\n`;
  result += `❗️ Notable Addresses: ${notableAddresses}\n\n`;
  result += `<strong>Holders Info</strong>\n\n`;

  finalWallets.forEach((wallet, index) => {
    const rank = index + 1;
    const emoji = getHoldingEmoji(wallet);
    result += `${rank} - <a href="https://solscan.io/account/${wallet.address}">${(wallet.address.substring(0, 6))}...${(wallet.address.slice(-4))}</a> → (${(wallet.supplyPercentage)}%) ${emoji}\n`;
    
    if (wallet.isInteresting) {
      result += `├ ❗️${wallet.category}\n`;
    }
    
    result += `├ 💳 Sol: ${wallet.solBalance}\n`;
    result += `└ 💲 Port: $${formatNumber(parseFloat(wallet.portfolioValue))}`;

    if (wallet.tokenInfos && wallet.tokenInfos.length > 0) {
      const topTokens = wallet.tokenInfos
        .filter(token => token.symbol !== 'SOL' && token.valueNumber >= 1000)
        .sort((a, b) => b.valueNumber - a.valueNumber)
        .slice(0, 3);

      if (topTokens.length > 0) {
        result += ` (${topTokens.map(token => 
          `<a href="https://dexscreener.com/solana/${token.mint}?maker=${wallet.address}">${token.symbol}</a> $${formatNumber(token.valueNumber)}`
        ).join(', ')})`;
      }
    }

    result += '\n\n';
  });

  return result;
}

function formatNumber(num) {
  return num.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function getHoldingEmoji(wallet) {
  const totalValue = parseFloat(wallet.portfolioValue);
  if (totalValue > 100000) return '🐳';
  if (totalValue > 50000) return '🦈';
  if (totalValue > 10000) return '🐬';
  if (totalValue > 1000) return '🐟';
  return '🦐';
}

function formatNumber(num) {
  return num.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

module.exports = { scanToken };