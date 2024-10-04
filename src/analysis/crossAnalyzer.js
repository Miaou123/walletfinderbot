const { getHolders } = require('../tools/getHolders');
const gmgnApi = require('../integrations/gmgnApi');
const { fetchMultipleWallets } = require('../tools/walletChecker');
const { isExcludedAddress } = require('../utils/excludedAddresses');

const MIN_TOKEN_THRESHOLD = 10000;

async function crossAnalyze(contractAddresses, minCombinedValue = 1000, mainContext = 'default') {
    console.log(`Starting cross-analysis for ${contractAddresses.length} contracts with min combined value of $${minCombinedValue} context: ${mainContext}`);

    try {
        // Vérifier les adresses de contrats pour les doublons
        const uniqueContractAddresses = [...new Set(contractAddresses)];
        if (uniqueContractAddresses.length !== contractAddresses.length) {
            console.warn('Duplicate contract addresses found. Using unique addresses only.');
            console.log('Unique contract addresses:', uniqueContractAddresses);
            contractAddresses = uniqueContractAddresses;
        }

        // Fetch holders and token prices in parallèle
        const [holdersLists, tokenPrices] = await Promise.all([
            Promise.all(contractAddresses.map((address, index) => getHolders(address, mainContext, `getHolders_${index}`))),
            Promise.all(contractAddresses.map((address, index) => gmgnApi.getTokenUsdPrice(address, mainContext, `getTokenUsdPrice_${index}`)))
        ]);

        console.log('Token prices retrieved:', tokenPrices);
        console.log('All holders lists retrieved. Starting comparison...');

        // Vérifier si les listes de détenteurs sont correctes
        holdersLists.forEach((holders, index) => {
            console.log(`Holders list for contract ${contractAddresses[index]} has ${holders.length} holders.`);
        });

        // Commencer avec la liste complète des détenteurs du premier token, en excluant les adresses non désirées
        let commonHolders = holdersLists[0]
            .filter(holder => holder.balance >= MIN_TOKEN_THRESHOLD && !isExcludedAddress(holder.address));

        // Trouver les détenteurs communs ayant le solde minimum requis pour chaque token
        for (let i = 1; i < holdersLists.length; i++) {
            const currentHoldersSet = new Set(
                holdersLists[i]
                    .filter(h => h.balance >= MIN_TOKEN_THRESHOLD && !isExcludedAddress(h.address))
                    .map(h => h.address)
            );

            commonHolders = commonHolders.filter(holder => currentHoldersSet.has(holder.address));
        }

        console.log(`${commonHolders.length} holders have all ${contractAddresses.length} coins above the threshold (excluding undesired addresses)`);

        // Calculer les valeurs pour chaque détenteur
        commonHolders = commonHolders.map(holder => {
            let combinedValue = 0;
            for (let i = 0; i < contractAddresses.length; i++) {
                const address = contractAddresses[i];
                const price = tokenPrices[i]?.data?.usd_price || 0;
                const holderData = holdersLists[i].find(h => h.address === holder.address);
                const balance = holderData ? holderData.balance : 0;
                const value = balance * price;

                console.log(`Holder ${holder.address} - Token ${address}: Balance = ${balance}, Price = ${price}, Value = ${value}`);

                holder[`balance_${address}`] = balance;
                holder[`value_${address}`] = value;
                combinedValue += value;
            }
            holder.combinedValue = combinedValue;
            return holder;
        });

        // Filtrer les détenteurs par valeur combinée
        commonHolders = commonHolders
            .filter(holder => holder.combinedValue >= minCombinedValue)
            .sort((a, b) => b.combinedValue - a.combinedValue);

        console.log(`${commonHolders.length} holders have a combined value of $${minCombinedValue} or more`);

        // Si vous souhaitez voir les détails des détenteurs finaux
        commonHolders.forEach(holder => {
            console.log(`Holder ${holder.address} - Combined Value: $${holder.combinedValue.toFixed(2)}`);
        });

        // Fetch additional wallet data si nécessaire
        if (commonHolders.length > 0) {
            const walletCheckerData = await fetchMultipleWallets(commonHolders.map(h => h.address), 5, mainContext, 'walletChecker');

            // Combine data
            const finalHolders = commonHolders.map(holder => {
                const walletData = walletCheckerData.find(w => w.wallet === holder.address);
                return {
                    ...holder,
                    walletCheckerData: walletData ? walletData.data.data : null
                };
            });

            return finalHolders;
        } else {
            return commonHolders;
        }
    } catch (error) {
        console.error('Error in crossAnalyze:', error);
        throw error;
    }
}

module.exports = { crossAnalyze };