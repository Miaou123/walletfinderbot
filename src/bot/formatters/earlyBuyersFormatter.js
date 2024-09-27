const { formatNumber } = require('./walletAnalyzerFormatter');

const MINIMUM_PORT_SIZE = 1000; // Valeur minimale du portefeuille en USD

const formatEarlyBuyersMessage = (earlyBuyers, tokenInfo, hours, coinAddress) => {
  if (earlyBuyers.length === 0) {
      return "No early buyers found in the specified time frame.";
  }

  let message = `<b>Early Buyers Analysis for ${tokenInfo.symbol}</b>\n\n`;

  // Fonction pour obtenir la valeur numérique du portefeuille
  const getPortValue = (buyer) => {
    const portSize = buyer.walletInfo && buyer.walletInfo.totalValue;
    if (typeof portSize === 'number') {
      return portSize;
    }
    if (typeof portSize === 'object' && portSize !== null && typeof portSize.toNumber === 'function') {
      return portSize.toNumber();
    }
    if (typeof portSize === 'string') {
      return parseFloat(portSize);
    }
    return 0; // Valeur par défaut si aucune des conditions n'est remplie
  };

  // Filtrer et trier les early buyers par taille de portefeuille
  const filteredBuyers = earlyBuyers
      .filter(buyer => {
          const portValue = getPortValue(buyer);
          return portValue >= MINIMUM_PORT_SIZE;
      })
      .sort((a, b) => {
          const portValueA = getPortValue(a);
          const portValueB = getPortValue(b);
          return portValueB - portValueA;
      });

  message += `${filteredBuyers.length} early buyers found\n\n`;

  for (const [index, buyer] of filteredBuyers.entries()) {
      message += formatSingleWallet(buyer, index, tokenInfo, coinAddress);
  }

  return message;
};

const formatSingleWallet = (buyer, index, tokenInfo, coinAddress) => {
  const rank = index + 1;
  const shortAddress = `${buyer.buyer.substring(0, 6)}...${buyer.buyer.slice(-4)}`;
  const amountFormatted = formatNumber(Number(buyer.amount) / Math.pow(10, tokenInfo.decimals));
  
  let result = `${rank} - <a href="https://solscan.io/account/${buyer.buyer}">${shortAddress}</a>\n`;
  result += `├ 🪙 Total Amount: ${amountFormatted} ${tokenInfo.symbol}\n`;

  if (buyer.walletInfo) {
      const walletData = buyer.walletInfo;
      
    // Check if the token is still held using coinAddress for comparison
    const tokenHolding = walletData.tokenInfos && walletData.tokenInfos.find(t => 
      t.mint && coinAddress && t.mint.toLowerCase() === coinAddress.toLowerCase()
    );
    if (tokenHolding && tokenHolding.amount > 10000) {
      result += `├ 💎 Still holding: ${formatNumber(tokenHolding.amount)} ($${formatNumber(tokenHolding.valueNumber)})\n`;
    }
      
      if (walletData.solBalance) {
          result += `├ 💳 Sol: ${walletData.solBalance}\n`;
      }

      if (walletData.totalValue) {
          const totalValue = typeof walletData.totalValue === 'number' 
              ? walletData.totalValue 
              : (typeof walletData.totalValue.toNumber === 'function' ? walletData.totalValue.toNumber() : parseFloat(walletData.totalValue));
          result += `└ 💲 Port: $${formatNumber(totalValue)}`;
      }

      // Display top tokens, including the analyzed token if it is held
      if (walletData.tokenInfos && Array.isArray(walletData.tokenInfos)) {
          const topTokens = walletData.tokenInfos
              .filter(token => token.symbol !== 'SOL' && token.valueNumber >= 1000)
              .sort((a, b) => b.valueNumber - a.valueNumber)
              .slice(0, 3);

          if (topTokens.length > 0) {
              result += ` (${topTokens.map(token => 
                  `<a href="https://dexscreener.com/solana/${token.mint}?maker=${buyer.buyer}">${token.symbol}</a> $${formatNumber(token.valueNumber)}`
              ).join(', ')})`;
          }
      }
  }

  return result + '\n\n';
};

module.exports = { formatEarlyBuyersMessage };