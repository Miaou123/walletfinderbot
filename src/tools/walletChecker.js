const pLimit = require('p-limit');
const gmgnApi = require('../integrations/gmgnApi');
const { getDatabase, saveInterestingWallet } = require('../database/database');
const logger = require('../utils/logger');

async function getWalletFromDatabase(address, database) {
    try {
        const collection = database.collection("wallets");
        const wallet = await collection.findOne({ address });
        const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

        if (wallet && wallet.refresh_date > fifteenMinutesAgo) {
            logger.debug(`Using cached wallet data for ${address}`);
            return {
                code: 0,
                msg: 'success',
                data: {
                    twitter_bind: wallet.twitter_bind,
                    balance: wallet.balance,
                    total_value: wallet.total_value,
                    realized_profit_30d: wallet.realized_profit_30d,
                    winrate: wallet.winrate,
                    buy_30d: wallet.buy_30d,
                    token_avg_cost: wallet.token_avg_cost,
                    token_sold_avg_profit: wallet.token_sold_avg_profit,
                    pnl_2x_5x_num: wallet.pnl_2x_5x_num,
                    pnl_gt_5x_num: wallet.pnl_gt_5x_num
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
                    // Vérifier d'abord dans la base de données
                    const cachedData = await getWalletFromDatabase(wallet, database);
                    
                    if (cachedData) {
                        logger.info(`Retrieved wallet ${wallet} from cache`);
                        return { wallet, data: cachedData };
                    }

                    // Si pas en cache ou expiré, faire l'appel API
                    logger.debug(`Fetching fresh data for wallet ${wallet}`);
                    const data = await gmgnApi.getWalletData(wallet, mainContext, subContext);
                    
                    // Sauvegarder dans la base de données
                    if (data) {
                        try {
                            await saveInterestingWallet(wallet, data.data);
                            logger.info(`Successfully saved wallet ${wallet} to database`);
                        } catch (dbError) {
                            logger.error(`Error saving wallet ${wallet} to database: ${dbError.message}`, { wallet, error: dbError });
                        }
                    }

                    return { wallet, data };
                } catch (error) {
                    logger.error(`Error processing wallet ${wallet}: ${error.message}`, { wallet, error });
                    return null;
                }
            })
        );

        const results = await Promise.all(promises);
        return results.filter(result => result !== null);
    } catch (error) {
        logger.error('Error in fetchMultipleWallets:', { error });
        throw error;
    }
}

module.exports = { fetchMultipleWallets };