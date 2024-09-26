const { formatNumber } = require('./walletAnalyzerFormatter');

const MINIMUM_PORT_SIZE = 1000; // Valeur minimale du portefeuille en USD

const formatEarlyBuyersMessage = (earlyBuyers, tokenInfo, hours, coinAddress) => {
  if (earlyBuyers.length === 0) {
      return "No early buyers found in the specified time frame.";
  }

  let message = `<b>Early Buyers Analysis for ${tokenInfo.symbol}</b>\n\n`;

  // Filtrer et trier les early buyers par taille de portefeuille
  const filteredBuyers = earlyBuyers
      .filter(buyer => {
          const portSize = buyer.walletInfo && buyer.walletInfo.totalValue;
          return portSize && (typeof portSize === 'number' ? portSize : portSize.toNumber()) >= MINIMUM_PORT_SIZE;
      })
      .sort((a, b) => {
          const portSizeA = typeof a.walletInfo.totalValue === 'number' ? a.walletInfo.totalValue : a.walletInfo.totalValue.toNumber();
          const portSizeB = typeof b.walletInfo.totalValue === 'number' ? b.walletInfo.totalValue : b.walletInfo.totalValue.toNumber();
          return portSizeB - portSizeA;
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

  // // Ajout de l'historique des transactions
  // if (buyer.transactions && buyer.transactions.length > 0) {
  //     result += `├ 📊 Transaction History:\n`;
  //     buyer.transactions.forEach((tx, i) => {
  //         const txAmount = formatNumber(Number(tx.amount) / Math.pow(10, tokenInfo.decimals));
  //         result += `│  ${i + 1}. ${txAmount} ${tokenInfo.symbol} at ${tx.timestamp}\n`;
  //     });
  // }

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
          result += `└ 💲 Port: $${formatNumber(typeof walletData.totalValue === 'number' ? walletData.totalValue : walletData.totalValue.toNumber())}`;
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