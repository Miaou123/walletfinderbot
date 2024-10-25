const definedApi = require('../integrations/definedApi');
const logger = require('../utils/logger');
const { isFreshWallet } = require('../tools/freshWalletChecker');

async function analyzeFreshRatio(coinAddress, minAmount, hours, tokenInfo, mainContext = 'default') {
    try {
        logger.info(`Starting fresh ratio analysis for ${coinAddress}`);
        logger.debug(`Analysis parameters: minAmount=${minAmount}, hours=${hours}, mainContext=${mainContext}`);
        
        const creationTimestamp = Math.floor(tokenInfo.creation_timestamp);
        const endTimestamp = creationTimestamp + (hours * 3600);
        logger.debug(`Analysis timeframe: ${new Date(creationTimestamp * 1000)} to ${new Date(endTimestamp * 1000)}`);

        const uniqueWallets = new Map();
        let cursor = null;
        let hasMoreEvents = true;
        let paginationCount = 0;
        
        while (hasMoreEvents) {
            paginationCount++;
            logger.debug(`Starting pagination iteration #${paginationCount}, cursor: ${cursor}`);
            
            try {
                const eventsResponse = await definedApi.getTokenEvents(
                    coinAddress,
                    creationTimestamp,
                    endTimestamp,
                    cursor,
                    100,
                    mainContext,
                    'getTokenEvents',
                    {
                        eventDisplayType: ["Buy"],
                        amountNonLiquidityToken: minAmount
                    }
                );

                const events = eventsResponse.data.getTokenEvents;
                logger.debug(`Received ${events?.items?.length || 0} events in this batch`);
                
                if (!events || !events.items || events.items.length === 0) {
                    logger.debug("No more events to process, breaking pagination loop");
                    break;
                }

                for (const event of events.items) {
                    const walletAddress = event.maker;
                    // Pour chaque wallet, ne garder que la première transaction
                    if (!uniqueWallets.has(walletAddress)) {
                        uniqueWallets.set(walletAddress, {
                            address: walletAddress,
                            firstBuyAmount: event.data.amountNonLiquidityToken,
                            timestamp: event.timestamp,
                            transactionHash: event.transactionHash
                        });
                        logger.debug(`New unique wallet found: ${walletAddress}, tx: ${event.transactionHash}`);
                    }
                }

                cursor = events.cursor;
                hasMoreEvents = cursor !== null && events.items.length === 100;
                
            } catch (error) {
                logger.error('Error fetching token events:', error);
                break;
            }
        }

        logger.info(`Found ${uniqueWallets.size} unique buyers after ${paginationCount} pagination iterations`);

        const walletsArray = Array.from(uniqueWallets.values());
        const batchSize = 10;
        const walletAnalysisResults = [];
        const totalBatches = Math.ceil(walletsArray.length / batchSize);

        logger.debug(`Starting wallet analysis in batches of ${batchSize}, total batches: ${totalBatches}`);

        for (let i = 0; i < walletsArray.length; i += batchSize) {
            const batchNumber = Math.floor(i / batchSize) + 1;
            logger.debug(`Processing batch ${batchNumber}/${totalBatches}`);
            
            const batch = walletsArray.slice(i, i + batchSize);
            const analysisTasks = batch.map(async wallet => {
                logger.debug(`Checking if wallet ${wallet.address} was fresh at tx ${wallet.transactionHash}`);
                const isFresh = await isFreshWallet(
                    wallet.address,
                    wallet.transactionHash,
                    mainContext,
                    'freshWalletCheck'
                );
                return {
                    ...wallet,
                    isFresh
                };
            });

            const batchResults = await Promise.all(analysisTasks);
            walletAnalysisResults.push(...batchResults);
            logger.debug(`Batch ${batchNumber} processed, total results so far: ${walletAnalysisResults.length}`);
        }

        const totalWallets = walletAnalysisResults.length;
        const freshWallets = walletAnalysisResults.filter(wallet => wallet.isFresh);
        const freshWalletsCount = freshWallets.length;
        const freshWalletsRatio = totalWallets > 0 ? (freshWalletsCount / totalWallets) * 100 : 0;

        logger.debug(`Analysis statistics: totalWallets=${totalWallets}, freshWallets=${freshWalletsCount}, ratio=${freshWalletsRatio}%`);
        logger.info(`Analysis completed. Fresh wallets ratio: ${freshWalletsRatio.toFixed(2)}%`);

        return {
            totalWallets,
            freshWalletsCount,
            freshWalletsRatio,
            wallets: walletAnalysisResults,
            analysisTimeframe: {
                start: creationTimestamp,
                end: endTimestamp
            }
        };

    } catch (error) {
        logger.error(`Error in analyzeFreshRatio for ${coinAddress}:`, error);
        logger.debug(`Full error details: ${error.stack}`);
        throw error;
    }
}

module.exports = {
    analyzeFreshRatio
};