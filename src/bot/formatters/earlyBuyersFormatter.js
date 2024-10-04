const { formatNumber } = require('./walletAnalyzerFormatter');

const MINIMUM_PORT_SIZE = 1000; // Valeur minimale du portefeuille en USD

const formatEarlyBuyersMessage = (earlyBuyers, tokenInfo, hours, coinAddress) => {
  if (earlyBuyers.length === 0) {
    return "No early buyers found in the specified time frame.";
  }

  let message = `<b>Early Buyers Analysis for ${tokenInfo.symbol}</b>\n\n`;

  // Fonction pour obtenir la valeur numérique du portefeuille
  const getPortValue = (buyer) => {
    const portSize = buyer.walletInfo && buyer.walletInfo.total_value;
    return typeof portSize === 'number' ? portSize : 0;
  };

  // Filtrer et trier les early buyers par taille de portefeuille
  const filteredBuyers = earlyBuyers
    .filter(buyer => getPortValue(buyer) >= MINIMUM_PORT_SIZE)
    .sort((a, b) => getPortValue(b) - getPortValue(a));

  message += `${filteredBuyers.length} early buyers found\n\n`;

  for (const [index, buyer] of filteredBuyers.entries()) {
    message += formatSingleWallet(buyer, index, tokenInfo, coinAddress);
  }

  return message;
};


const formatSingleWallet = (buyer, index, tokenInfo, coinAddress) => {
  const rank = index + 1;
  const truncatedWallet = truncateAddress(buyer.buyer);
  const amountFormatted = formatNumber(Number(buyer.amount) / Math.pow(10, tokenInfo.decimals));
  
  let pnlEmoji = '❓'; // Emoji par défaut si pas d'information sur le PNL
  if (buyer.walletInfo && buyer.walletInfo.total_value) {
    pnlEmoji = getEmojiForPnl(buyer.walletInfo.total_value);
  }

  let result = `${rank}. <a href="https://solscan.io/account/${buyer.buyer}">${truncatedWallet}</a> ${pnlEmoji} `;
  result += `<a href="https://gmgn.ai/sol/address/${buyer.buyer}">gmgn</a>/`;
  result += `<a href="https://app.cielo.finance/profile/${buyer.buyer}/pnl/tokens">cielo</a>\n`;
  
  result += `├ 🪙 Total Amount: ${amountFormatted} ${tokenInfo.symbol}\n`;

  if (buyer.walletInfo) {
    const walletData = buyer.walletInfo;
    
    if (walletData.total_value) {
      const solBalance = walletData.sol_balance ? ` ( Sol: ${formatNumber(walletData.sol_balance, 2)} )` : '';
      result += `├ 💼 Port: $${formatNumber(walletData.total_value, 0)}${solBalance}\n`;
    }

    if (walletData.realized_profit_30d || walletData.unrealized_profit) {
      const realizedPL = walletData.realized_profit_30d ? `$${formatNumber(walletData.realized_profit_30d, 0)}` : 'N/A';
      const unrealizedPL = walletData.unrealized_profit ? `$${formatNumber(walletData.unrealized_profit, 0)}` : 'N/A';
      result += `├ 💰 P/L (30d): ${realizedPL} / uP/L: ${unrealizedPL}\n`;
    }

    if (walletData.winrate) {
      const winratePercentage = (walletData.winrate * 100).toFixed(2);
      result += `└ 📊 Winrate (30d): ${winratePercentage}%`;
    }
  }

  return result + '\n\n';
};

module.exports = { formatEarlyBuyersMessage };