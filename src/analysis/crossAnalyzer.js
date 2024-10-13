const { getHolders } = require('../tools/getHolders');
const gmgnApi = require('../integrations/gmgnApi');
const { fetchMultipleWallets } = require('../tools/walletChecker');
const { isExcludedAddress } = require('../utils/excludedAddresses');

const MIN_TOKEN_THRESHOLD = 10000;

async function fetchHoldersAndPrices(contractAddresses, mainContext) {
    return Promise.all([
        Promise.all(contractAddresses.map((address, index) => 
            getHolders(address, mainContext, `getHolders_${index}`))),
        Promise.all(contractAddresses.map((address, index) => 
            gmgnApi.getTokenUsdPrice(address, mainContext, `getTokenUsdPrice_${index}`)))
    ]);
}

async function crossAnalyze(contractAddresses, minCombinedValue = 1000, mainContext = 'default') {
    try {
        const uniqueContractAddresses = [...new Set(contractAddresses)];
        if (uniqueContractAddresses.length !== contractAddresses.length) {
            console.warn('Duplicate contract addresses found. Using unique addresses only.');
            contractAddresses = uniqueContractAddresses;
        }

        const [holdersLists, tokenPrices] = await fetchHoldersAndPrices(contractAddresses, mainContext);

        // Create a map of all holders
        const allHoldersMap = new Map();

        holdersLists.forEach((holdersList, index) => {
            holdersList.forEach(holder => {
                if (holder.balance >= MIN_TOKEN_THRESHOLD && !isExcludedAddress(holder.address)) {
                    if (!allHoldersMap.has(holder.address)) {
                        allHoldersMap.set(holder.address, {
                            address: holder.address,
                            tokensHeld: new Set(),
                            combinedValue: 0
                        });
                    }
                    allHoldersMap.get(holder.address).tokensHeld.add(index);
                }
            });
        });

        // Calculate values and filter holders
        const relevantHolders = Array.from(allHoldersMap.values())
            .filter(holder => holder.tokensHeld.size >= 2)
            .map(holder => {
                let combinedValue = 0;
                contractAddresses.forEach((address, index) => {
                    const price = tokenPrices[index]?.data?.usd_price || 0;
                    const holderData = holdersLists[index].find(h => h.address === holder.address);
                    const balance = holderData ? holderData.balance : 0;
                    const value = balance * price;

                    holder[`balance_${address}`] = balance;
                    holder[`value_${address}`] = value;
                    combinedValue += value;
                });
                holder.combinedValue = combinedValue;
                return holder;
            })
            .filter(holder => holder.combinedValue >= minCombinedValue)
            .sort((a, b) => {
                if (b.tokensHeld.size !== a.tokensHeld.size) {
                    return b.tokensHeld.size - a.tokensHeld.size;
                }
                return b.combinedValue - a.combinedValue;
            });

        if (relevantHolders.length > 0) {
            const walletCheckerData = await fetchMultipleWallets(relevantHolders.map(h => h.address), 5, mainContext, 'walletChecker');

            return relevantHolders.map(holder => ({
                ...holder,
                walletCheckerData: walletCheckerData.find(w => w.wallet === holder.address)?.data?.data || null
            }));
        }

        return relevantHolders;
    } catch (error) {
        console.error('Error in crossAnalyze:', error);
        throw error;
    }
}

module.exports = { crossAnalyze };