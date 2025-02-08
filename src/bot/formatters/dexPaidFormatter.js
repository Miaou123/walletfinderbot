const formatDexPaidResponse = (orders, tokenInfo) => {
    // Si on n'a pas les infos de base, on affiche quand même le format standard
    let symbol = tokenInfo?.pairData?.symbol || 'Unknown';
    let address = orders?.[0]?.baseToken?.address || tokenInfo?.address;

    const sections = [];
    
    if (tokenInfo?.pairData?.symbol && orders?.[0]?.baseToken?.address) {
        sections.push(`📊 <b>DexScreener Status for <a href="https://solscan.io/token/${orders[0].baseToken.address}">$${tokenInfo.pairData.symbol}</a></b>`);
    } else {
        sections.push(`📊 <b>DexScreener Status</b>`);
    }

    // Si on n'a pas de données ou des données invalides, on met tout en ❌
    if (!orders || !Array.isArray(orders) || orders.length === 0) {
        sections.push(`Token Profile: ❌`);
        sections.push(`tokenAd: ❌`);
        sections.push(`Boost: ❌`);
        return sections.join('\n');
    }

    // Sinon on continue avec la logique normale
    const tokenProfileOrders = orders.filter(order => order.type === 'tokenProfile');
    sections.push(`Token Profile: ${tokenProfileOrders.length > 0 && tokenProfileOrders[0].status === 'approved' ? '✅' : '❌'}`);

    const tokenAdOrders = orders.filter(order => order.type === 'tokenAd');
    sections.push(`tokenAd: ${tokenAdOrders.length > 0 && tokenAdOrders[0].status === 'approved' ? '✅' : '❌'}`);

    const boostPoints = tokenInfo?.boosts || 0;
    sections.push(`Boost: ${boostPoints > 0 ? `⚡${boostPoints.toLocaleString()}` : '❌'}`);

    return sections.join('\n');
};

module.exports = { formatDexPaidResponse };