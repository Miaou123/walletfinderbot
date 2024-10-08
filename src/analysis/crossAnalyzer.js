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

function filterCommonHolders(holdersLists) {
    let commonHolders = holdersLists[0]
        .filter(holder => holder.balance >= MIN_TOKEN_THRESHOLD && !isExcludedAddress(holder.address));

    for (let i = 1; i < holdersLists.length; i++) {
        const currentHoldersSet = new Set(
            holdersLists[i]
                .filter(h => h.balance >= MIN_TOKEN_THRESHOLD && !isExcludedAddress(h.address))
                .map(h => h.address)
        );
        commonHolders = commonHolders.filter(holder => currentHoldersSet.has(holder.address));
    }

    return commonHolders;
}

function calculateHolderValues(commonHolders, holdersLists, contractAddresses, tokenPrices) {
    return commonHolders.map(holder => {
        let combinedValue = 0;
        for (let i = 0; i < contractAddresses.length; i++) {
            const address = contractAddresses[i];
            const price = tokenPrices[i]?.data?.usd_price || 0;
            const holderData = holdersLists[i].find(h => h.address === holder.address);
            const balance = holderData ? holderData.balance : 0;
            const value = balance * price;

            holder[`balance_${address}`] = balance;
            holder[`value_${address}`] = value;
            combinedValue += value;
        }
        holder.combinedValue = combinedValue;
        return holder;
    });
}

async function crossAnalyze(contractAddresses, minCombinedValue = 1000, mainContext = 'default') {
    console.log(`Starting cross-analysis for ${contractAddresses.length} contracts with min combined value of $${minCombinedValue} context: ${mainContext}`);

    try {
        const uniqueContractAddresses = [...new Set(contractAddresses)];
        if (uniqueContractAddresses.length !== contractAddresses.length) {
            console.warn('Duplicate contract addresses found. Using unique addresses only.');
            contractAddresses = uniqueContractAddresses;
        }

        const [holdersLists, tokenPrices] = await fetchHoldersAndPrices(contractAddresses, mainContext);

        console.log('Token prices retrieved:', tokenPrices);
        console.log('All holders lists retrieved. Starting comparison...');

        holdersLists.forEach((holders, index) => {
            console.log(`Holders list for contract ${contractAddresses[index]} has ${holders.length} holders.`);
        });

        let commonHolders = filterCommonHolders(holdersLists);

        console.log(`${commonHolders.length} holders have all ${contractAddresses.length} coins above the threshold (excluding undesired addresses)`);

        commonHolders = calculateHolderValues(commonHolders, holdersLists, contractAddresses, tokenPrices);

        commonHolders = commonHolders
            .filter(holder => holder.combinedValue >= minCombinedValue)
            .sort((a, b) => b.combinedValue - a.combinedValue);

        console.log(`${commonHolders.length} holders have a combined value of $${minCombinedValue} or more`);

        if (commonHolders.length > 0) {
            const walletCheckerData = await fetchMultipleWallets(commonHolders.map(h => h.address), 5, mainContext, 'walletChecker');

            return commonHolders.map(holder => ({
                ...holder,
                walletCheckerData: walletCheckerData.find(w => w.wallet === holder.address)?.data?.data || null
            }));
        }

        return commonHolders;
    } catch (error) {
        console.error('Error in crossAnalyze:', error);
        throw error;
    }
}

module.exports = { crossAnalyze };