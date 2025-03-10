// EntryPriceAnalyzer.js
const { getSolanaApi } = require('../integrations/solanaApi');
const definedApi = require('../integrations/definedApi');
const dexscreenerApi = require('../integrations/dexScreenerApi');
const pumpfunApi = require('../integrations/pumpfunApi'); 
const { getTopHolders } = require('../tools/getHolders');
const BigNumber = require('bignumber.js');
const logger = require('../utils/logger');
const PoolAndBotDetector = require('../tools/poolAndBotDetector');

class EntryPriceAnalyzer {
    constructor() {
        this.poolAndBotDetector = new PoolAndBotDetector();
        this.BATCH_SIZE = 10;
        this.MAX_EVENTS = 100;
    }

    async getTokenMetadata(tokenAddress, mainContext, subContext) {
        try {
            logger.debug('Fetching token metadata from Helius...');
            const solanaApi = getSolanaApi();
            
            // Récupérer les infos du token
            const assetInfo = await solanaApi.getAsset(tokenAddress, mainContext, 'entryPriceAnalyzer');
            
            // Récupérer le prix du SOL pour les conversions
            const solInfo = await dexscreenerApi.getTokenInfo(
                "So11111111111111111111111111111111111111112"
            );
    
            if (!assetInfo) {
                throw new Error("No token info found");
            }
    
            // Extraire les données
            return {
                decimals: assetInfo.decimals || 0,
                symbol: assetInfo.symbol || 'Unknown',
                priceUsd: assetInfo.price || 0,
                solPriceUsd: Number(solInfo.pairData.priceUsd) || 0,
                priceInSol: assetInfo.price && solInfo.pairData.priceUsd ? 
                            new BigNumber(assetInfo.price)
                                .div(solInfo.pairData.priceUsd)
                                .toNumber() : 0,
                address: tokenAddress,
                totalSupply: assetInfo.supply.total || 0  // Supply déjà ajustée avec les décimales
            };
    
        } catch (error) {
            logger.error('Error fetching token metadata:', error);
            // On peut garder DexScreener comme fallback si nécessaire
            logger.warn('Helius API failed, falling back to DexScreener');
            const [dexInfo, solInfo] = await Promise.all([
                dexscreenerApi.getTokenInfo(tokenAddress),
                dexscreenerApi.getTokenInfo("So11111111111111111111111111111111111111112")
            ]);
    
            // Extraire les données DexScreener
            const pair = dexInfo.pairData;
            const solPair = solInfo.pairData;
            
            return {
                decimals: pair.decimals || 0,
                symbol: pair.baseToken?.symbol || 'Unknown',
                priceUsd: Number(pair.priceUsd) || 0,
                solPriceUsd: Number(solPair.priceUsd) || 0,
                priceInSol: pair.priceUsd && solPair.priceUsd ? 
                            new BigNumber(pair.priceUsd)
                                .div(solPair.priceUsd)
                                .toNumber() : 0,
                address: tokenAddress,
                totalSupply: pair.totalSupply || 0
            };
        }
    }
    

    async fetchPumpfunTradesByUser(tokenAddress, tokenDecimals, mainContext = 'default', subContext = null) {
        let offset = 0;
        const limit = 200;
        let hasMoreTransactions = true;
        const allTransactions = [];

        while (hasMoreTransactions) {
            const transactions = await pumpfunApi.getAllTrades(
                tokenAddress,
                limit,
                offset,
                0, // minimumSize
                mainContext,
                subContext
            );

            if (transactions && transactions.length > 0) {
                allTransactions.push(...transactions);
                logger.debug(`Total PumpFun transactions fetched so far: ${allTransactions.length}`);
                offset += limit;
            } else {
                hasMoreTransactions = false;
                logger.debug('No more transactions found from PumpFun API');
            }
        }

        // Regrouper les trades par utilisateur
        const tradesByUser = {};

        for (const tx of allTransactions) {
            const userAddress = tx.user;
            if (!tradesByUser[userAddress]) {
                tradesByUser[userAddress] = [];
            }
            tradesByUser[userAddress].push(tx);
        }

        return tradesByUser;
    }

    async analyzeTokenEntries(tokenAddress, numHolders = 20, mainContext = 'default', subContext = null) {
        try {
            logger.debug('Starting token analysis...');
            logger.debug(`Parameters: token=${tokenAddress}, numHolders=${numHolders}`);

            const [tokenInfo, holders] = await Promise.all([
                this.getTokenMetadata(tokenAddress, mainContext, subContext),
                getTopHolders(tokenAddress, numHolders, mainContext, subContext)
            ]);

            logger.debug(`Retrieved ${holders.length} holders to analyze`);
            logger.debug(`Token metadata: ${JSON.stringify(tokenInfo)}`);

            // Récupérer les transactions PumpFun
            logger.debug('Fetching PumpFun trades for the token...');
            const pumpfunTradesByUser = await this.fetchPumpfunTradesByUser(tokenAddress, tokenInfo.decimals, mainContext, subContext);
            logger.debug(`Fetched PumpFun trades for ${Object.keys(pumpfunTradesByUser).length} users`);

            const results = [];
            for (let i = 0; i < holders.length; i += this.BATCH_SIZE) {
                const batch = holders.slice(i, i + this.BATCH_SIZE);
                logger.debug(`Processing batch ${i / this.BATCH_SIZE + 1}, holders ${i} to ${i + batch.length}`);

                const batchPromises = batch.map(async holder => {
                    logger.debug(`\nAnalyzing holder: ${holder.address}`);

                    const walletType = await this.poolAndBotDetector.analyzeWallet(
                        { wallet: holder.address, data: holder },
                        mainContext
                    );

                    if (walletType.type === 'pool' || walletType.type === 'bot') {
                        logger.debug(`Skipping ${holder.address} (${walletType.type})`);
                        return null;
                    }

                    try {
                        logger.debug(`Fetching events for ${holder.address}`);
                        // Récupérer les événements de l'API Defined
                        const events = await definedApi.getTokenEvents(
                            tokenAddress,
                            0,
                            Math.floor(Date.now() / 1000),
                            null,
                            this.MAX_EVENTS,
                            mainContext,
                            subContext,
                            {
                                maker: holder.address,
                                eventDisplayType: ["Buy"],
                                direction: "ASC"
                            }
                        );

                        logger.debug(`Got ${events.data?.getTokenEvents?.items?.length || 0} events`);

                        const entries = this.processDefinedEvents(events.data.getTokenEvents.items);
                        logger.debug(`Processed ${entries.length} entries from Defined API`);

                        // Récupérer et traiter les événements de PumpFun pour ce détenteur
                        const pumpfunEventsRaw = pumpfunTradesByUser[holder.address] || [];
                        const pumpfunEvents = this.processPumpfunEvents(pumpfunEventsRaw, tokenInfo.decimals);
                        logger.debug(`Processed ${pumpfunEvents.length} events from PumpFun for holder ${holder.address}`);

                        // Combiner les événements des deux sources
                        const allEvents = [...entries, ...pumpfunEvents];
                        allEvents.sort((a, b) => a.timestamp - b.timestamp); // Trier par date

                        // Procéder au calcul du prix d'entrée moyen
                        const holderResult = {
                            holderAddress: holder.address,
                            balance: holder.balance,
                            entries: this.calculateAverageEntry(allEvents),
                            walletType
                        };
                        logger.debug(`Holder result:`, holderResult);
                        return holderResult;
                    } catch (error) {
                        logger.error(`Error processing holder ${holder.address}:`, error);
                        return null;
                    }
                });

                const batchResults = await Promise.all(batchPromises);
                const validBatchResults = batchResults.filter(r => r !== null);
                logger.debug(`Batch completed: ${validBatchResults.length}/${batchResults.length} valid results`);

                results.push(...validBatchResults);
            }

            const filteredResults = results.filter(result =>
                !result?.walletType ||
                (result.walletType.type !== 'pool' && result.walletType.type !== 'bot')
            );

            logger.debug('=== ANALYSIS SUMMARY ===');
            logger.debug(`Total holders processed: ${holders.length}`);
            logger.debug(`Valid results: ${filteredResults.length}`);
            logger.debug(`Current price in SOL: ${tokenInfo.priceInSol}`);

            const finalResults = this.aggregateResults(filteredResults, tokenInfo);

            logger.debug('=== FINAL RESULTS ===');
            logger.debug('Token Info:', finalResults.tokenInfo);
            logger.debug('Summary:', finalResults.summary);
            logger.debug('Price Ranges:', finalResults.priceRanges);
            logger.debug(`Number of holders in final results: ${Object.keys(finalResults.holders).length}`);
            logger.debug('Sample holder data:', Object.entries(finalResults.holders)[0]);

            return finalResults;

        } catch (error) {
            logger.error('Error in analyzeTokenEntries:', error);
            throw error;
        }
    }

    processDefinedEvents(events) {
        if (!events || !Array.isArray(events)) {
            logger.warn('Invalid events data:', events);
            return [];
        }

        logger.debug(`Processing ${events.length} events`);
        const processed = events.map(event => {
            const swapData = event.data;
            if (swapData.__typename !== 'SwapEventData') {
                return null; // Ignorer les événements non-Swap si nécessaire
            }

            // Déterminer le montant en tokens
            let amount;
            if (swapData.amount0 && parseFloat(swapData.amount0) > 0) {
                amount = parseFloat(swapData.amount0);
            } else if (swapData.amount1 && parseFloat(swapData.amount1) > 0) {
                amount = parseFloat(swapData.amount1);
            } else {
                amount = 0;
            }

            const processedEvent = {
                type: event.eventDisplayType.toLowerCase(), // 'buy' ou 'sell'
                timestamp: event.timestamp * 1000,
                amount: amount,
                priceInSol: parseFloat(swapData.priceBaseToken),
                txSignature: event.transactionHash
            };
            logger.debug(`Processed event: ${JSON.stringify(processedEvent)}`);
            return processedEvent;
        }).filter(event => event !== null);
        logger.debug(`Successfully processed ${processed.length} events`);
        return processed;
    }

    processPumpfunEvents(events, tokenDecimals) {
        if (!events || !Array.isArray(events)) {
            logger.warn('Invalid PumpFun events data:', events);
            return [];
        }

        const processed = events.map(event => {
            // Convertir sol_amount de lamports en SOL (1 SOL = 1e9 lamports)
            const solAmount = new BigNumber(event.sol_amount).dividedBy(1e9);
            // Convertir token_amount en utilisant tokenDecimals
            const tokenAmount = new BigNumber(event.token_amount).dividedBy(new BigNumber(10).pow(tokenDecimals));
            // Calculer le prix par token en SOL
            const priceInSol = solAmount.dividedBy(tokenAmount).toNumber();
            const processedEvent = {
                type: event.is_buy ? 'buy' : 'sell',
                timestamp: event.timestamp * 1000, // Convertir en millisecondes
                amount: tokenAmount.toNumber(), // Montant en tokens
                priceInSol: priceInSol,
                txSignature: event.signature
            };
            return processedEvent;
        });

        return processed;
    }

    calculateAverageEntry(entries) {
        if (!entries || entries.length === 0) return null;

        let totalAmount = new BigNumber(0);
        let weightedPriceSum = new BigNumber(0);

        entries.forEach(entry => {
            logger.debug(`Processing entry: ${JSON.stringify(entry)}`);
            if (entry.type === 'buy') {
                const amount = new BigNumber(entry.amount);
                totalAmount = totalAmount.plus(amount);
                weightedPriceSum = weightedPriceSum.plus(amount.times(entry.priceInSol));
            }
        });

        if (totalAmount.isZero()) return null;

        const avgPrice = weightedPriceSum.div(totalAmount);
        const result = {
            averagePrice: avgPrice.toNumber(),
            totalAmount: totalAmount.toNumber(),
            firstEntry: entries[0],
            lastEntry: entries[entries.length - 1],
            numTransactions: entries.length
        };

        logger.debug(`Average entry calculation:`, result);
        return result;
    }

    aggregateResults(results, tokenInfo) {
        logger.debug("Aggregating results for token:", tokenInfo.symbol);
        logger.debug(`Processing ${results.length} valid results`);

        const validResults = results.filter(r => r?.entries);
        logger.debug(`Found ${validResults.length} results with valid entries`);

        const avgHoldingSize = results.reduce((acc, r) => acc + (r?.balance || 0), 0) / results.length;
        logger.debug(`Average holding size: ${avgHoldingSize}`);

        const priceRanges = this.calculatePriceRanges(validResults);
        logger.debug("Calculated price ranges:", priceRanges);

        const holders = {};
        results.forEach(result => {
            if (result && result.holderAddress) {
                holders[result.holderAddress] = {
                    ...result.entries,
                    currentBalance: result.balance,
                    status: this.getHolderStatus(result)
                };
            }
        });
        logger.debug(`Processed ${Object.keys(holders).length} holders`);

        const aggregatedResults = {
            tokenInfo: {
                address: tokenInfo.address,
                symbol: tokenInfo.symbol,
                currentPriceUsd: tokenInfo.priceUsd,
                currentPriceInSol: tokenInfo.priceInSol,
                solPriceUsd: tokenInfo.solPriceUsd,
                totalSupply: tokenInfo.totalSupply,            
                decimals: tokenInfo.decimals                   
            },
            summary: {
                totalHolders: results.length,
                validResults: validResults.length,
                avgHoldingSize
            },
            priceRanges,
            holders
        };

        logger.debug("Final aggregated results:", aggregatedResults);
        return aggregatedResults;
    }

    calculatePriceRanges(results) {
        logger.debug(`Calculating price ranges for ${results.length} results`);

        if (results.length === 0) {
            logger.debug('No results to calculate price ranges');
            return [];
        }

        const prices = results
            .filter(r => r.entries?.averagePrice)
            .map(r => r.entries.averagePrice);

        logger.debug(`Found ${prices.length} valid prices for range calculation`);
        logger.debug('Price list:', prices);

        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const range = max - min;
        const step = range / 5;

        logger.debug(`Price range: min=${min}, max=${max}, step=${step}`);

        const ranges = Array.from({ length: 5 }, (_, i) => {
            const start = min + (step * i);
            const end = start + step;
            const holdersInRange = results.filter(r =>
                r.entries?.averagePrice >= start &&
                r.entries?.averagePrice < end
            ).length;

            logger.debug(`Range ${i + 1}: ${start}-${end}: ${holdersInRange} holders`);
            return { start, end, holders: holdersInRange };
        });

        return ranges;
    }

    getHolderStatus(result) {
        if (result.error) {
            return { type: 'error', message: result.error };
        }
        if (!result.entries) {
            return { type: 'no_activity', message: 'No token activity found' };
        }
        return { type: 'buy', message: 'Direct buy' };
    }
}

module.exports = EntryPriceAnalyzer;
