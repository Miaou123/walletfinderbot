const { fetchMultipleWallets } = require('../tools/walletChecker');
const dexScreenerApi = require('../integrations/dexScreenerApi');
const definedApi = require('../integrations/definedApi');
const pumpfunApi = require('../integrations/pumpfunApi');
const logger = require('../utils/logger');

const MAXIMUM_UPL = 2000000;
const BOT_TRANSACTION_THRESHOLD = 10000;
const BOT_TRANSACTION_DIFFERENCE_THRESHOLD = 0.05;

const processPumpfunTransactions = (transactions, walletsData) => {
    logger.debug(`Processing ${transactions.length} Pumpfun transactions`);
    for (const tx of transactions) {
        logger.debug(`Processing transaction: ${JSON.stringify(tx)}`);
        const wallet = tx.user;
        const tokenAmount = tx.token_amount * Math.pow(10, -6); // Ajuster les décimales (6 pour tokens pumpfun)
        const solAmount = tx.sol_amount * Math.pow(10, -9); // Ajuster les décimales (9 pour SOL amount)

        const currentData = walletsData.get(wallet) || {
            wallet,
            bought_amount_token: 0,
            sold_amount_token: 0,
            bought_amount_sol: 0,
            sold_amount_sol: 0,
            dex: 'pumpfun',
            transactions: []
        };

        if (tx.is_buy) {
            currentData.bought_amount_token += tokenAmount;
            currentData.bought_amount_sol += solAmount;
        } else {
            currentData.sold_amount_token += tokenAmount;
            currentData.sold_amount_sol += solAmount;
        }

        currentData.transactions.push({
            signature: tx.signature,
            tokenAmount,
            solAmount,
            timestamp: new Date(tx.timestamp * 1000).toISOString(),
            is_buy: tx.is_buy,
            dex: 'pumpfun'
        });

        walletsData.set(wallet, currentData);
        logger.debug(`Processed Pumpfun transactions. WalletsData size: ${walletsData.size}`);
    }
};

const calculateTokenAmounts = (event) => {
    const wsolExchanged = parseFloat(event.token0SwapValueUsd) / parseFloat(event.token0PoolValueUsd);
    const tokensBought = (1 / parseFloat(event.token1ValueBase)) * wsolExchanged;
    
    return {
        baseToken: {
            amount: wsolExchanged,
            value: parseFloat(event.token0SwapValueUsd)
        },
        quoteToken: {
            amount: tokensBought,
            value: parseFloat(event.token1SwapValueUsd) * parseFloat(event.token0PoolValueUsd)
        }
    };
};

const processDefinedEvents = (events, walletsData, tokenInfo, endTimestamp) => {
    for (const event of events.items) {
        logger.debug(`Processing event: ${JSON.stringify(event)}`);

        // Si l'événement est hors du cadre temporel, on arrête le traitement
        if (event.timestamp > endTimestamp) {
            return false;
        }

        const wallet = event.maker;
        const data = event.data;
        
        // On s'assure que les données de swap sont présentes
        if (!data || data.__typename !== 'SwapEventData') {
            logger.warn(`No SwapEventData found for event: ${event.transactionHash}`);
            continue;
        }

        // Variables pour stocker les quantités échangées
        let tokenAmount, usdAmount;

        // Calcul des montants en fonction du type d'événement (Buy/Sell)
        if (event.eventDisplayType === 'Buy') {
            // Si c'est un "Buy", l'utilisateur reçoit le quoteToken (token1)
            tokenAmount = Math.abs(parseFloat(data.amount1));  // Montant en token1
            usdAmount = parseFloat(data.priceUsdTotal);  // Valeur totale en USD
        } else if (event.eventDisplayType === 'Sell') {
            // Si c'est un "Sell", l'utilisateur vend le quoteToken (token1)
            tokenAmount = Math.abs(parseFloat(data.amount1));  // Montant en token1
            usdAmount = parseFloat(data.priceUsdTotal);  // Valeur totale en USD
        } else {
            logger.warn(`Unexpected event type: ${event.eventDisplayType}`);
            continue;
        }

        // Récupération ou initialisation des données du wallet
        const currentData = walletsData.get(wallet) || {
            wallet,
            bought_amount_token: 0,
            sold_amount_token: 0,
            bought_amount_usd: 0,
            sold_amount_usd: 0,
            dex: null,  // Pas de DEX spécifié dans cet exemple
            transactions: []
        };

        // Mise à jour des montants en fonction du type de transaction (Buy/Sell)
        if (event.eventDisplayType === 'Buy') {
            currentData.bought_amount_token += tokenAmount;
            currentData.bought_amount_usd += usdAmount;
        } else if (event.eventDisplayType === 'Sell') {
            currentData.sold_amount_token += tokenAmount;
            currentData.sold_amount_usd += usdAmount;
        }

        // Ajout de la transaction dans les données du portefeuille
        currentData.transactions.push({
            signature: event.transactionHash,
            tokenAmount,
            usdAmount,
            timestamp: new Date(event.timestamp * 1000).toISOString(),
            is_buy: event.eventDisplayType === 'Buy',
            dex: null  // DEX non spécifié
        });

        // Mise à jour des données du wallet dans le Map
        walletsData.set(wallet, currentData);

        logger.debug(`Updated wallet data for ${wallet}: ${JSON.stringify(currentData)}`);
    }

    logger.debug(`Processed Defined events. WalletsData size: ${walletsData.size}`);
    return true;
};


const isBotWallet = (walletData) => {
    logger.debug(`Checking if wallet is bot: ${JSON.stringify(walletData)}`);
    const buy = parseInt(walletData.buy) || 0;
    const sell = parseInt(walletData.sell) || 0;
    const totalTransactions = buy + sell;
    const upl = parseFloat(walletData.unrealized_profit) || 0;

    if (totalTransactions < BOT_TRANSACTION_THRESHOLD) {
        return false;
    }

    const difference = Math.abs(buy - sell) / totalTransactions;
    const isHighUPL = upl > MAXIMUM_UPL;

    return difference < BOT_TRANSACTION_DIFFERENCE_THRESHOLD || isHighUPL;
};


const analyzeEarlyBuyers = async (tokenAddress, minPercentage = 1, timeFrameHours = 1, mainContext = 'default') => {
    logger.debug(`Starting analysis for token: ${tokenAddress}, minPercentage: ${minPercentage}, timeFrameHours: ${timeFrameHours}`);
    try {
        let tokenInfo;
        let totalSupply;
        let creationTimestamp;
        const walletsData = new Map();

        const isPumpfunToken = tokenAddress.endsWith('pump');
        logger.debug(`Is Pumpfun token: ${isPumpfunToken}`);

        if (isPumpfunToken) {
            logger.debug(`Fetching token info from DexScreener for: ${tokenAddress}`);
            tokenInfo = await dexScreenerApi.getTokenInfo(tokenAddress, mainContext);
            logger.debug(`Token info from DexScreener: ${JSON.stringify(tokenInfo)}`);

            let offset = 0;
            const limit = 200;
            let hasMoreTransactions = true;
            const allTransactions = [];

            while (hasMoreTransactions) {
                logger.debug(`Fetching Pumpfun trades. Offset: ${offset}, Limit: ${limit}`);
                const transactions = await pumpfunApi.getAllTrades(
                    tokenAddress,
                    limit,
                    offset,
                    0,
                    mainContext,
                    'getAllTrades'
                );
                logger.debug(`Fetched ${transactions ? transactions.length : 0} transactions from Pumpfun API`);

                if (transactions && transactions.length > 0) {
                    allTransactions.push(...transactions);
                    offset += limit;
                } else {
                    hasMoreTransactions = false;
                }
            }

            logger.debug(`Total transactions fetched: ${allTransactions.length}`);

            const lastTransactionTimestamp = allTransactions[allTransactions.length - 1].timestamp;
            const firstTransactionTimestamp = allTransactions[0].timestamp;

            const timeDifference = firstTransactionTimestamp - lastTransactionTimestamp;
            const timeFrameSeconds = timeFrameHours * 3600;

            totalSupply = Math.floor(parseFloat(tokenInfo.totalSupply) * Math.pow(10, tokenInfo.decimals));
            logger.debug(`Total supply: ${totalSupply}`);

            processPumpfunTransactions(allTransactions, walletsData);

            if (timeDifference >= timeFrameSeconds) {
                logger.debug('Using Pumpfun data only');
            } else {
                logger.debug('Fetching additional data from Defined API');

                creationTimestamp = lastTransactionTimestamp;
                const endTimestamp = creationTimestamp + timeFrameSeconds;

                let cursor = null;
                let hasMoreEvents = true;
                const limitEvents = 100;

                while (hasMoreEvents) {
                    try {
                        logger.debug(`Fetching Defined events. Cursor: ${cursor}, Limit: ${limitEvents}`);
                        const eventsResponse = await definedApi.getTokenEvents(
                            tokenAddress,
                            creationTimestamp,
                            endTimestamp,
                            cursor,
                            limitEvents,
                            mainContext,
                            'getTokenEvents'
                        );

                        const events = eventsResponse.data.getTokenEvents;
                        logger.debug(`Fetched ${events && events.items ? events.items.length : 0} events from Defined API`);

                        if (!events || !events.items || events.items.length === 0) {
                            logger.debug("No more events to process from Defined API");
                            break;
                        }

                        hasMoreEvents = processDefinedEvents(events, walletsData, tokenInfo, endTimestamp);
                        cursor = events.cursor;
                        hasMoreEvents = hasMoreEvents && cursor !== null && events.items.length === limitEvents;
                    } catch (error) {
                        logger.error('Error fetching token events from Defined API:', error);
                        break;
                    }
                }
            }
        } else {
            logger.debug('Processing classic token with Defined API');
            logger.debug(`Fetching token info from DexScreener for: ${tokenAddress}`);
            tokenInfo = await dexScreenerApi.getTokenInfo(tokenAddress, mainContext);
            logger.debug(`Token info from DexScreener: ${JSON.stringify(tokenInfo)}`);

            creationTimestamp = Math.floor(tokenInfo.pairCreatedAt / 1000);
            const endTimestamp = creationTimestamp + (timeFrameHours * 3600);

            totalSupply = Math.floor(parseFloat(tokenInfo.totalSupply) * Math.pow(10, tokenInfo.decimals));
            logger.debug(`Total supply: ${totalSupply}`);

            let cursor = null;
            let hasMoreEvents = true;
            const limitEvents = 100;

            while (hasMoreEvents) {
                try {
                    logger.debug(`Fetching Defined events. Cursor: ${cursor}, Limit: ${limitEvents}`);
                    const eventsResponse = await definedApi.getTokenEvents(
                        tokenAddress,
                        creationTimestamp,
                        endTimestamp,
                        cursor,
                        limitEvents,
                        mainContext,
                        'getTokenEvents'
                    );

                    const events = eventsResponse.data.getTokenEvents;
                    logger.debug(`Fetched ${events && events.items ? events.items.length : 0} events from Defined API`);

                    if (!events || !events.items || events.items.length === 0) {
                        logger.debug("No more events to process");
                        break;
                    }

                    hasMoreEvents = processDefinedEvents(events, walletsData, tokenInfo, endTimestamp);
                    cursor = events.cursor;
                    hasMoreEvents = hasMoreEvents && cursor !== null && events.items.length === limitEvents;
                } catch (error) {
                    logger.error('Error fetching token events:', error);
                    break;
                }
            }
        }

        const qualifiedWallets = new Map(
            Array.from(walletsData.entries()).filter(([_, data]) => {
                const isQualified = data.bought_amount_token >= (totalSupply * minPercentage) / 100;
                logger.debug(`Wallet ${_.wallet} qualification: ${isQualified}. Bought: ${data.bought_amount_token}, Threshold: ${(totalSupply * minPercentage) / 100}`);
                return isQualified;
            })
        );

        const walletAddresses = Array.from(qualifiedWallets.keys());
        logger.debug(`Fetching wallet analysis for ${walletAddresses.length} addresses`);
        const walletAnalysis = await fetchMultipleWallets(walletAddresses, 5, mainContext, 'fetchEarlyBuyers');
        logger.debug(`Fetched wallet analysis: ${JSON.stringify(walletAnalysis)}`);

        const filteredEarlyBuyers = new Map();

        for (const [wallet, data] of qualifiedWallets) {
            const walletData = walletAnalysis.find(w => w.wallet === wallet);
            logger.debug(`Processing wallet ${wallet}, data: ${JSON.stringify(walletData)}`);
            if (walletData?.data?.data && !isBotWallet(walletData.data.data)) {
                filteredEarlyBuyers.set(wallet, {
                    ...data,
                    walletInfo: walletData.data.data
                });
            } else {
                logger.debug(`Wallet bot excluded: ${wallet}`);
            }
        }

        logger.debug(`Number of filtered early buyers: ${filteredEarlyBuyers.size}`);

        const result = {
            earlyBuyers: Array.from(filteredEarlyBuyers.values()),
            tokenInfo
        };
        logger.debug(`Analysis result: ${JSON.stringify(result)}`);
        return result;

    } catch (error) {
        logger.error(`Analysis failed for token ${tokenAddress}:`, error);
        throw error;
    }
};

module.exports = { analyzeEarlyBuyers };