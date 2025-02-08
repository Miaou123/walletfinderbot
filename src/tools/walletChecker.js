const pLimit = require('p-limit');
const gmgnApi = require('../integrations/gmgnApi');
const { getDatabase, WalletService } = require('../database');
const logger = require('../utils/logger');

async function getWalletFromDatabase(address, database) {
    try {
        const collection = database.collection("wallets");
        const wallet = await collection.findOne({ address });
        const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

        if (wallet && wallet.refresh_date > fifteenMinutesAgo) {
            logger.debug(`Using cached wallet data for ${address}`);
            // On retourne toutes les données dans le même format que l'API
            return {
                code: 0,
                msg: 'success',
                data: {
                    ...wallet,
                    // On exclut les champs de métadonnées
                    refresh_date: undefined,
                    lastUpdated: undefined,
                    created_at: undefined,
                    _id: undefined
                }
            };
        }
        return null;
    } catch (error) {
        logger.error(`Error fetching wallet ${address} from database:`, error);
        return null;
    }
}


async function fetchMultipleWallets(wallets, concurrency = 5, mainContext, subContext = 'fetchMultipleWallets') {
    const limit = pLimit(concurrency);
    const database = await getDatabase();
 
    try {
        const promises = wallets.map(wallet => 
            limit(async () => {
                try {
                    const cachedData = await getWalletFromDatabase(wallet, database);
                    if (cachedData) {
                        logger.info(`Retrieved wallet ${wallet} from cache`);
                        return { wallet, data: cachedData };
                    }
 
                    const data = await gmgnApi.getWalletData(wallet, mainContext, subContext);
                    if (data) {
                        try {
                            await WalletService.saveInterestingWallet(wallet, data.data);
                            logger.info(`Successfully saved wallet ${wallet} to database`);
                        } catch (dbError) {
                            logger.error(`Error saving wallet ${wallet} to database: ${dbError.message}`);
                        }
                    }
 
                    return { wallet, data };
                } catch (error) {
                    logger.error(`Error processing wallet ${wallet}: ${error.message}`);
                    return null;
                }
            })
        );
 
        return (await Promise.all(promises)).filter(Boolean);
    } catch (error) {
        logger.error('Error in fetchMultipleWallets:', error);
        throw error;
    }
 }

module.exports = { fetchMultipleWallets };