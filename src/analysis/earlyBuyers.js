const { fetchMultipleWallets } = require('../tools/walletChecker');
const definedApi = require('../integrations/definedApi');
const pumpfunApi = require('../integrations/pumpfunApi');
const logger = require('../utils/logger');
const { isBotWallet } = require('../tools/poolAndBotDetector');

const processPumpfunTransactions = (transactions, walletsData) => {
    logger.debug(`Processing ${transactions.length} Pumpfun transactions`);
    
    for (const tx of transactions) {

        const wallet = tx.user;
        const tokenAmount = tx.token_amount;
        const solAmount = tx.sol_amount;

        updateWalletData(walletsData, wallet, tokenAmount, solAmount, tx.is_buy, 'pumpfun', tx.signature, tx.timestamp);
    }
};

const processDefinedEvents = (events, walletsData, endTimestamp) => {

    for (const event of events.items) {
        if (event.timestamp > endTimestamp) {
            return false;
        }

        const wallet = event.maker;
        const data = event.data;
    
        if (!data || data.__typename !== 'SwapEventData') {
            logger.warn(`No SwapEventData found for event: ${event.transactionHash}`);
            continue;
        }

        let tokenAmount, solAmount;
        const isBuy = event.eventDisplayType === 'Buy';

        if (isBuy) {
            tokenAmount = Math.abs(parseFloat(data.amount1));
            solAmount = Math.abs(parseFloat(data.amount0));
        } else {
            tokenAmount = Math.abs(parseFloat(data.amount1));
            solAmount = Math.abs(parseFloat(data.amount0));
        }

        updateWalletData(walletsData, wallet, tokenAmount, solAmount, isBuy, null, event.transactionHash, event.timestamp);
    }
    return true;
};

const updateWalletData = (walletsData, wallet, tokenAmount, solAmount, isBuy, dex, signature, timestamp) => {
    const currentData = walletsData.get(wallet) || {
        wallet,
        bought_amount_token: 0,
        sold_amount_token: 0,
        bought_amount_sol: 0,
        sold_amount_sol: 0,
        dex: dex,
        transactions: []
    };

    if (isBuy) {
        currentData.bought_amount_token += tokenAmount;
        currentData.bought_amount_sol += solAmount;
    } else {
        currentData.sold_amount_token += tokenAmount;
        currentData.sold_amount_sol += solAmount;
    }

    currentData.transactions.push({
        signature,
        tokenAmount,
        solAmount,
        timestamp: new Date(timestamp * 1000).toISOString(),
        is_buy: isBuy,
        dex
    });

    walletsData.set(wallet, currentData);
};

const analyzeEarlyBuyers = async (coinAddress, minPercentage, timeFrameHours, tokenInfo, mainContext = 'default', pumpFlag = '') => {
    
    try {
        const walletsData = new Map();
        const isPumpfunToken = coinAddress.endsWith('pump');

        const tokenDecimals = tokenInfo.decimals || 6;
        const solDecimals = 9;
        const totalSupply = parseFloat(tokenInfo.totalSupply);
        const solPrice = parseFloat(tokenInfo.solPrice);

        const thresholdAmount = (totalSupply * minPercentage / 100) * Math.pow(10, tokenDecimals);

        let creationTimestamp;

        // Vérification du flag 'pump' pour un token non-Pumpfun
        if (pumpFlag === 'pump' && !isPumpfunToken) {
            throw new Error("This token is not a pumpfun token. If you want to use the 'pump' flag please use a pumpfun token.");
        }

        // Analyse Pumpfun
        if (isPumpfunToken && (pumpFlag === 'pump' || pumpFlag === '')) {
            let offset = 0;
            const limit = 200;
            let hasMoreTransactions = true;
            const allTransactions = [];

            while (hasMoreTransactions) {
                const transactions = await pumpfunApi.getAllTrades(
                    coinAddress,
                    limit,
                    offset,
                    pumpFlag === 'pump' ? 0 : timeFrameHours * 3600,
                    mainContext,
                    'getAllTrades'
                );

                if (transactions && transactions.length > 0) {
                    allTransactions.push(...transactions);
                    logger.debug(`Total transactions fetched so far: ${allTransactions.length}`);
                    offset += limit;
                } else {
                    hasMoreTransactions = false;
                    logger.debug('No more transactions found from Pumpfun API');
                }
            }

            if (allTransactions.length === 0) {
                logger.warn('No Pumpfun transactions were found');
                if (pumpFlag === 'pump') {
                    return { earlyBuyers: [], tokenInfo };
                }
            } else {
                processPumpfunTransactions(allTransactions, walletsData);
                creationTimestamp = allTransactions[allTransactions.length - 1].timestamp;
            }
        }

        // Analyse Defined (sauf si flag 'pump')
        if (pumpFlag !== 'pump') {
            creationTimestamp = Math.floor(tokenInfo.pairCreatedAt / 1000);
            const endTimestamp = creationTimestamp + (timeFrameHours * 3600);
            let cursor = null;
            let hasMoreEvents = true;
            const limitEvents = 100;

            while (hasMoreEvents) {
                try {
                    const eventsResponse = await definedApi.getTokenEvents(
                        coinAddress,
                        creationTimestamp,
                        endTimestamp,
                        cursor,
                        limitEvents,
                        mainContext,
                        'getTokenEvents'
                    );

                    const events = eventsResponse.data.getTokenEvents;

                    if (!events || !events.items || events.items.length === 0) {
                        logger.debug("No more events to process from Defined API");
                        break;
                    }

                    hasMoreEvents = processDefinedEvents(events, walletsData, endTimestamp);
                    cursor = events.cursor;
                    hasMoreEvents = hasMoreEvents && cursor !== null && events.items.length === limitEvents;
                } catch (error) {
                    logger.error('Error fetching token events from Defined API:', error);
                    break;
                }
            }
        }

        // Filter wallets with a significant amount of tokens
        const qualifiedWallets = new Map(
            Array.from(walletsData.entries()).filter(([wallet, data]) => {
                if (typeof data.bought_amount_token !== 'number' || isNaN(data.bought_amount_token)) {
                    logger.warn(`Invalid bought_amount_token for wallet ${wallet}: ${data.bought_amount_token}`);
                    return false;
                }
                const isQualified = data.bought_amount_token >= thresholdAmount;
                return isQualified;
            })
        );

        const walletAddresses = Array.from(qualifiedWallets.keys());
        logger.debug(`Fetching wallet analysis for ${walletAddresses.length} addresses`);
        const walletAnalysis = await fetchMultipleWallets(walletAddresses, 5, mainContext, 'fetchEarlyBuyers');

        const filteredEarlyBuyers = [];

        for (const [wallet, data] of qualifiedWallets) {
            try {
                const walletData = walletAnalysis.find(w => w.wallet === wallet);
                if (walletData?.data?.data && !isBotWallet(walletData.data.data)) {
                    // Ajuster les montants et calculer les valeurs en USD ici
                    const adjustedBoughtToken = data.bought_amount_token * Math.pow(10, -tokenDecimals);
                    const adjustedSoldToken = data.sold_amount_token * Math.pow(10, -tokenDecimals);
                    const adjustedBoughtSol = data.bought_amount_sol * Math.pow(10, -solDecimals);
                    const adjustedSoldSol = data.sold_amount_sol * Math.pow(10, -solDecimals);
                    const buyAmountUsd = adjustedBoughtSol * solPrice;
                    const sellAmountUsd = adjustedSoldSol * solPrice;
    
                    filteredEarlyBuyers.push({
                        wallet,
                        bought_amount_token: adjustedBoughtToken,
                        sold_amount_token: adjustedSoldToken,
                        bought_amount_sol: adjustedBoughtSol,
                        sold_amount_sol: adjustedSoldSol,
                        bought_amount_usd: buyAmountUsd,
                        sold_amount_usd: sellAmountUsd,
                        dex: data.dex || null,
                        walletInfo: walletData.data.data
                    });
                } else {
                    logger.debug(`Wallet excluded or identified as bot: ${wallet}`);
                }
            } catch (error) {
                logger.error(`Error processing wallet ${wallet}:`, error);
            }
        }
    
        logger.debug(`Number of filtered early buyers: ${filteredEarlyBuyers.length}`);
    
        const result = {
            earlyBuyers: filteredEarlyBuyers,
            tokenInfo,
            solPrice
        };
        return result;

    } catch (error) {
        logger.error(`Analysis failed for token ${coinAddress}:`, error);
        throw error;
    }
};

module.exports = { analyzeEarlyBuyers };