const { getAssetsForMultipleWallets } = require('../tools/walletValueCalculator');
const { getHolders, getTopHolders } = require('../tools/getHolders');

const MIN_TOKEN_THRESHOLD = 1000;

async function crossAnalyze(contractAddresses, minCombinedValue = DEFAULT_MIN_COMBINED_VALUE) {
    console.log(`Starting cross-analysis for ${contractAddresses.length} contracts with min combined value of $${minCombinedValue}`);

    try {
        const holdersLists = await Promise.all(
            contractAddresses.map(async (address) => {
                console.log(`Fetching holders for contract ${address}`);
                const holders = await getHolders(address);
                console.log(`Retrieved ${holders.length} holders for contract ${address}`);
                return holders;
            })
        );

        console.log('All holders lists retrieved. Starting comparison...');

        let commonHolders = holdersLists[0];

        for (let i = 1; i < holdersLists.length; i++) {
            console.log(`Comparing with holders of contract ${contractAddresses[i]}`);
            commonHolders = commonHolders.filter(holder => 
                holdersLists[i].some(h => h.address === holder.address && h.balance >= MIN_TOKEN_THRESHOLD)
            );
            console.log(`${commonHolders.length} common holders found after comparison`);
        }

        commonHolders = commonHolders.filter(holder => 
            holdersLists.every(list => 
                list.some(h => h.address === holder.address && h.balance >= MIN_TOKEN_THRESHOLD)
            )
        );

        console.log(`${commonHolders.length} holders have all ${contractAddresses.length} coins above the threshold`);

        const commonHolderAddresses = commonHolders.map(holder => holder.address);
        console.log(`Fetching assets for ${commonHolderAddresses.length} common holders`);
        const walletAssets = await getAssetsForMultipleWallets(commonHolderAddresses);
        
        console.log('Wallet assets fetched. Sample of first wallet:', JSON.stringify(Object.entries(walletAssets)[0], null, 2));

        const filteredHolders = Object.entries(walletAssets)
        .map(([address, assets]) => {
            console.log(`Processing wallet: ${address}`);

            if (!assets || !assets.tokenInfos) {
                console.log(`Warning: No valid asset data for wallet ${address}`);
                return null;
            }

            const relevantTokens = contractAddresses.map(contractAddress => {
                const token = assets.tokenInfos.find(t => t && t.mint === contractAddress);
                if (!token) {
                    console.log(`Warning: Token ${contractAddress} not found in wallet ${address}`);
                }
                return token ? parseFloat(token.value) : 0;
            });
            const combinedValue = relevantTokens.reduce((sum, value) => sum + value, 0);
            return { address, combinedValue, ...assets };
        })
        .filter(holder => holder !== null && holder.combinedValue >= minCombinedValue)
        .sort((a, b) => b.combinedValue - a.combinedValue);

    console.log(`Final result: ${filteredHolders.length} holders have a combined value of $${minCombinedValue} or more`);

    return filteredHolders;
} catch (error) {
    console.error('Error in crossAnalyze:', error);
    throw error;
}
}

module.exports = { crossAnalyze };