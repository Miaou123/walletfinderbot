const { fetchMultipleWallets } = require('../tools/walletChecker');
const dexScreenerApi = require('../integrations/dexScreenerApi');
const definedApi = require('../integrations/definedApi');

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

const MAXIMUM_UPL = 2000000; 

const isBotWallet = (walletData) => {
    const buy = parseInt(walletData.buy) || 0;
    const sell = parseInt(walletData.sell) || 0;
    const totalTransactions = buy + sell;
    const upl = parseFloat(walletData.unrealized_profit) || 0;

    if (totalTransactions < 10000) {
        return false;
    }

    // Vérifie si le nombre d'achats et de ventes est proche (différence de moins de 5%)
    const difference = Math.abs(buy - sell) / totalTransactions;
    
    // Vérifie si l'uP/L est supérieur à 2 millions
    const isHighUPL = upl > MAXIMUM_UPL;

    return difference < 0.05 || isHighUPL;
};

const analyzeEarlyBuyers = async (tokenAddress, minPercentage = 1, timeFrameHours = 1, mainContext = 'default') => {
    console.log(`Starting analysis for ${tokenAddress}`);

    try {
        const tokenInfo = await dexScreenerApi.getTokenInfo(tokenAddress, mainContext);
        console.log(`Token info retrieved for ${tokenAddress}:`, JSON.stringify(tokenInfo, null, 2));

        const creationTimestamp = Math.floor(tokenInfo.pairCreatedAt / 1000);
        const endTimestamp = creationTimestamp + (timeFrameHours * 3600);

        console.log(`Pair creation: ${new Date(creationTimestamp * 1000).toISOString()}`);
        console.log(`End time: ${new Date(endTimestamp * 1000).toISOString()}`);

        const totalSupply = Math.floor(parseFloat(tokenInfo.totalSupply) * Math.pow(10, tokenInfo.decimals));
        const minAmountRaw = (totalSupply * minPercentage) / 100;
        console.log(`Minimum amount (raw): ${minAmountRaw}`);

        let cursor = null;
        let hasMoreEvents = true;
        const limit = 100;

        const earlyBuyers = new Map();

        while (hasMoreEvents) {
            try {
                console.log(`Fetching events with cursor: ${cursor}`);
                const eventsResponse = await definedApi.getTokenEvents(
                    tokenAddress,
                    creationTimestamp,
                    endTimestamp,
                    cursor,
                    limit,
                    mainContext,
                    'getTokenEvents'
                );
                
                const events = eventsResponse.data.getTokenEvents;
                console.log(`Received ${events.items.length} events`);

                if (!events || !events.items || events.items.length === 0) {
                    console.log("No more events to process");
                    break;
                }

                for (const event of events.items) {
                    if (event.timestamp > endTimestamp) {
                        console.log(`Event timestamp ${event.timestamp} exceeds end timestamp ${endTimestamp}`);
                        hasMoreEvents = false;
                        break;
                    }

                    if (event.eventDisplayType === "Buy") {
                        const buyer = event.maker;
                        const tokenAmounts = calculateTokenAmounts(event);
                        const amount = Math.floor(tokenAmounts.quoteToken.amount * Math.pow(10, tokenInfo.decimals));

                        const currentData = earlyBuyers.get(buyer) || { amount: 0, transactions: [] };
                        const newAmount = currentData.amount + amount;

                        earlyBuyers.set(buyer, {
                            amount: newAmount,
                            transactions: [
                                ...currentData.transactions,
                                {
                                    signature: event.transactionHash,
                                    amount,
                                    baseTokenAmount: tokenAmounts.baseToken.amount,
                                    baseTokenValue: tokenAmounts.baseToken.value,
                                    quoteTokenAmount: tokenAmounts.quoteToken.amount,
                                    quoteTokenValue: tokenAmounts.quoteToken.value,
                                    timestamp: new Date(event.timestamp * 1000).toISOString()
                                }
                            ]
                        });
                    }
                }

                cursor = events.cursor;
                hasMoreEvents = cursor !== null && events.items.length === limit;
                console.log(`Next cursor: ${cursor}, Has more events: ${hasMoreEvents}`);
            } catch (error) {
                console.error('Error fetching token events:', error);
                break;
            }
        }

        const qualifiedEarlyBuyers = new Map(
            Array.from(earlyBuyers.entries()).filter(([_, data]) => data.amount >= minAmountRaw)
        );

        console.log(`Detected ${qualifiedEarlyBuyers.size} potential early buyers`);

        const walletAddresses = Array.from(qualifiedEarlyBuyers.keys());
        console.log(`Fetching wallet data for ${walletAddresses.length} addresses`);
        const walletAnalysis = await fetchMultipleWallets(walletAddresses, 5, mainContext, 'fetchEarlyBuyers');

        const filteredEarlyBuyers = new Map();

        for (const [buyer, data] of qualifiedEarlyBuyers) {
            const walletData = walletAnalysis.find(w => w.wallet === buyer);
            if (walletData && walletData.data && walletData.data.data) {
                if (!isBotWallet(walletData.data.data)) {
                    filteredEarlyBuyers.set(buyer, {
                        ...data,
                        walletAddress: buyer,
                        walletInfo: walletData.data.data
                    });
                } else {
                    console.log(`Excluded bot wallet: ${buyer}`);
                }
            }
        }

        console.log(`Analysis complete. Returning results for ${filteredEarlyBuyers.size} early buyers`);

        return { 
            earlyBuyers: Array.from(filteredEarlyBuyers.values()),
            tokenInfo
        };

    } catch (error) {
        console.error(`Analysis failed for token ${tokenAddress}:`, error);
        throw error;
    }
};

module.exports = {
    analyzeEarlyBuyers
};