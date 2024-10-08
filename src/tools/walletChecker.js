const pLimit = require('p-limit');
const gmgnApi = require('../integrations/gmgnApi');
const { processWallets } = require('../database/walletFilter');
const logger = require('../utils/logger');

async function fetchMultipleWallets(wallets, concurrency = 5, mainContext, subContext = 'fetchMultipleWallets') {
    const limit = pLimit(concurrency);

    try {
        const promises = wallets.map(wallet => 
            limit(async () => {
                try {
                    const data = await gmgnApi.getWalletData(wallet, mainContext, subContext);
                    return { wallet, data };
                } catch (error) {
                    logger.error(`Error fetching data for ${wallet}: ${error.message}`, { wallet, error });
                    return null;
                }
            })
        );

        const results = await Promise.all(promises);

        processWallets(results.filter(result => !result.error));

        return results.filter(result => result !== null);
    } catch (error) {
        logger.error('Error in fetchMultipleWallets:', { error });
        throw error;
    }
}

module.exports = { fetchMultipleWallets };
