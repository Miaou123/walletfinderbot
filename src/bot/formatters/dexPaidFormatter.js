const formatDexPaidResponse = (orders, tokenInfo) => {
    if (!orders || !Array.isArray(orders) || orders.length === 0) {
        return '❌ No active DexScreener orders found for this token';
    }

    const sections = [];
    const symbol = tokenInfo.pairData?.symbol;
    const address = orders[0]?.baseToken?.address;
    
    sections.push(`📊 <b>DexScreener Status for <a href="https://solscan.io/token/${address}">$${symbol}</a></b>`);

    const tokenProfileOrders = orders.filter(order => order.type === 'tokenProfile');
    if (tokenProfileOrders.length > 0) {
        const status = tokenProfileOrders[0].status === 'approved' ? '✅' : '❌';
        sections.push(`Token Profile: ${status}`);
    }

    const tokenAdOrders = orders.filter(order => order.type === 'tokenAd');
    if (tokenAdOrders.length > 0) {
        sections.push(`tokenAd: ${tokenAdOrders[0].status === 'approved' ? '✅' : '❌'}`);
    }

    const boostPoints = tokenInfo.boosts || 0;
    sections.push(`Boost: ${boostPoints > 0 ? `⚡${boostPoints.toLocaleString()}` : '❌'}`);

    return sections.join('\n');
};

module.exports = { formatDexPaidResponse };