const { formatNumber } = require('./walletAnalyzerFormatter');

const formatCrossAnalysisMessage = (filteredHolders, contractAddresses, tokenInfos) => {
    if (!Array.isArray(filteredHolders) || filteredHolders.length === 0) {
      console.warn('No filtered holders to format');
      return ['No common holders found matching the criteria.'];
    }
  
    let message = `<b>Cross-Analysis Results</b>\n\n`;
    message += `Analyzed tokens:\n${tokenInfos.map(t => `${t.symbol} (${t.address})`).join('\n')}\n\n`;
    message += `Total common holders: ${filteredHolders.length}\n\n`;
  
    const walletMessages = filteredHolders.map((wallet, index) => 
      formatCrossAnalysisWallet(wallet, contractAddresses, index + 1)
    );
    
    const validMessages = walletMessages.filter(msg => msg !== '');
    message += validMessages.join('\n');
  
    return [message];
  };

  const formatCrossAnalysisWallet = (wallet, contractAddresses, rank) => {
    if (!wallet || !wallet.tokenInfos) {
      console.error('Invalid wallet data:', wallet);
      return '';
    }
  
    const shortAddress = `${wallet.address.slice(0, 4)}...${wallet.address.slice(-4)}`;
    let result = `${rank} - <a href="https://solscan.io/account/${wallet.address}">${shortAddress}</a>\n`;
  
    const relevantTokens = wallet.tokenInfos.filter(token => 
      contractAddresses.includes(token.mint)
    );
  
    if (relevantTokens.length === 0) {
      console.warn('No relevant tokens found for wallet:', wallet.address);
      return '';
    }
  
    const combinedValueDetails = relevantTokens.map(token => 
      `$${formatNumber(parseFloat(token.value))} ${token.symbol}`
    ).join(', ');
  
    result += `├ 💰 Combined Value: $${formatNumber(wallet.combinedValue)} (${combinedValueDetails})\n`;
    
    if (wallet.totalValue) {
      result += `├ 💲 Port: $${formatNumber(parseFloat(wallet.totalValue))}\n`;
    }
  
    if (wallet.solBalance) {
      result += `└ 💳 Sol: ${wallet.solBalance}\n`;
    }
  
    return result + '\n';
  };
  

module.exports = { 
    formatCrossAnalysisMessage,
    formatCrossAnalysisWallet
};