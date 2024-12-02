// formatter.js

const { formatNumber, formatAge } = require('./generalFormatters');

const formatEntryMapResponse = (entryMap) => {
    const { tokenInfo, summary, priceRanges, holders } = entryMap;
    const sections = [];

    // Logs de débogage
    console.log("Received EntryMap:", {
        tokenInfo,
        summary,
        priceRanges,
        holdersCount: holders ? Object.keys(holders).length : 0
    });

    // En-tête avec liens
    sections.push(
        `<a href="https://dexscreener.com/solana/${tokenInfo.address}">📊</a> ` +
        `<a href="https://solscan.io/token/${tokenInfo.address}">${tokenInfo.symbol}</a>\n`
    );

    // Filtrer les pools et les bots
    const filteredHolders = {};
    Object.entries(holders || {}).forEach(([address, data]) => {
        if (!data.walletType || (data.walletType.type !== 'pool' && data.walletType.type !== 'bot')) {
            filteredHolders[address] = data;
        }
    });

    // Log de débogage pour les holders filtrés
    console.log("Filtered Holders:", {
        totalHolders: Object.keys(filteredHolders).length,
        sampleHolder: Object.entries(filteredHolders)[0]
    });

    // Recalculer les statistiques avec les holders filtrés
    const validHolders = Object.values(filteredHolders).filter(h => h && h.averagePrice);
    const avgEntry = calculateAverageEntry(validHolders);
    const avgPnl = ((tokenInfo.currentPriceInSol - avgEntry) / avgEntry * 100);

    // Log de débogage pour les statistiques
    console.log("Calculated Stats:", {
        validHoldersCount: validHolders.length,
        avgEntry,
        avgPnl
    });

    // Calculer la moyenne de la market cap d'entrée en USD
    const avgEntryUsd = avgEntry * tokenInfo.solPriceUsd;
    const avgEntryMarketCapUsd = avgEntryUsd * tokenInfo.totalSupply;

    sections.push('<b>Summary:</b>');
    sections.push(
        `Avg Entry MCAP: ${formatNumber(avgEntryMarketCapUsd, 2)} USD | ` +
        `Avg PnL: ${formatNumber(avgPnl, 2, true)}%`
    );

    // Liste des holders filtrés
    sections.push('\n<b>Top Holders:</b>');
    Object.entries(filteredHolders).forEach(([address, data]) => {
        // Log de débogage pour chaque holder
        console.log(`Processing holder ${address}:`, data);

        if (!data || !data.status) {
            sections.push(
                `❓ <a href="https://solscan.io/account/${address}">${address.slice(0, 4)}...${address.slice(-4)}</a> | ` +
                `Balance: ${formatNumber(data?.currentBalance || 0)} | No activity found`
            );
            return;
        }

        const currentBalance = formatNumber(data.currentBalance || 0);

        // Calculer le pourcentage de supply
        let supplyPercentage = '';
        if (tokenInfo.totalSupply && data.currentBalance) {
            const balanceAdjusted = data.currentBalance / Math.pow(10, tokenInfo.decimals || 0);
            supplyPercentage = (balanceAdjusted / tokenInfo.totalSupply) * 100;
            supplyPercentage = `${formatNumber(supplyPercentage, 2)}%`;

            // Logs de débogage
            console.log('Balance Adjusted:', balanceAdjusted);
            console.log('Total Supply:', tokenInfo.totalSupply);
            console.log('Supply Percentage:', supplyPercentage);
        } else {
            supplyPercentage = 'N/A';
        }

        switch (data.status.type) {
            case 'error':
                sections.push(
                    `⚠️ <a href="https://solscan.io/account/${address}">${address.slice(0, 4)}...${address.slice(-4)}</a> | ` +
                    `Balance: ${currentBalance} | Error: ${data.status.message}`
                );
                break;

            case 'no_activity':
                sections.push(
                    `⚪ <a href="https://solscan.io/account/${address}">${address.slice(0, 4)}...${address.slice(-4)}</a> | ` +
                    `${supplyPercentage} | Balance: ${formatNumber(data.currentBalance)} | Transfered`
                );
                break;

            case 'buy':
            case 'direct_buy':
            case 'transfer':
                if (data.averagePrice) {
                    const pnl = ((tokenInfo.currentPriceInSol - data.averagePrice) / data.averagePrice * 100);
                    const age = formatAge(data.firstEntry?.timestamp);

                    // Calculer la Market Cap d'entrée
                    let entryMarketCap = '';
                    if (tokenInfo.totalSupply && data.averagePrice) {
                        // Convertir le prix moyen d'entrée de SOL à USD
                        const averagePriceUsd = data.averagePrice * tokenInfo.solPriceUsd;

                        entryMarketCap = averagePriceUsd * tokenInfo.totalSupply;
                        entryMarketCap = `${formatNumber(entryMarketCap, 2)}`;

                        // Logs de débogage
                        console.log('Average Price (SOL):', data.averagePrice);
                        console.log('Average Price (USD):', averagePriceUsd);
                        console.log('Total Supply:', tokenInfo.totalSupply);
                        console.log('Entry MCAP (USD):', entryMarketCap);
                    } else {
                        entryMarketCap = 'N/A';
                    }

                    if (data.transfers?.length > 0) {
                        data.transfers.forEach(transfer => {
                            sections.push(
                                `${getEmojiForPnl(pnl)} ` +
                                `<a href="https://solscan.io/account/${address}">${address.slice(0, 4)}...${address.slice(-4)}</a> ` +
                                `transferred from ` +
                                `<a href="https://solscan.io/account/${transfer.fromAddress}">${transfer.fromAddress.slice(0, 4)}...${transfer.fromAddress.slice(-4)}</a> | ` +
                                `${supplyPercentage} | ` +
                                `Avg Entry: ${entryMarketCap} | ` +
                                `PnL: ${formatNumber(pnl, 2, true)} | ` +
                                `${age} ago`
                            );
                        });
                    } else {
                        sections.push(
                            `${getEmojiForPnl(pnl)} ` +
                            `<a href="https://solscan.io/account/${address}">${address.slice(0, 4)}...${address.slice(-4)}</a> | ` +
                            `${supplyPercentage} | ` +
                            `Avg Entry: ${entryMarketCap} | ` +
                            `PnL: ${formatNumber(pnl, 2, true)} | ` +
                            `${age} ago`
                        );
                    }
                }
                break;
        }
    });

    // Log de débogage pour le résultat final
    console.log("Generated Sections:", sections.length);

    return sections.join('\n');
};

const calculateAverageEntry = (validHolders) => {
    if (validHolders.length === 0) return 0;
    return validHolders.reduce((sum, data) => sum + data.averagePrice, 0) / validHolders.length;
};

const getEmojiForPnl = (pnl) => {
    if (pnl > 0) return '🟢';
    if (pnl < 0) return '🔴';
    return '🟥';
};

module.exports = {
    formatEntryMapResponse
};
