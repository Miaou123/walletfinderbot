const { fetchMultipleWallets } = require('../tools/walletChecker');
const dexScreenerApi = require('../integrations/dexScreenerApi');
const definedApi = require('../integrations/definedApi');

const MAXIMUM_UPL = 2000000;
const BOT_TRANSACTION_THRESHOLD = 10000;
const BOT_TRANSACTION_DIFFERENCE_THRESHOLD = 0.05;

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

const isBotWallet = (walletData) => {
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

const processEvents = (events, endTimestamp, earlyBuyers, tokenInfo) => {
    for (const event of events.items) {
        if (event.timestamp > endTimestamp) {
            return false;
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
    return true;
};

const analyzeEarlyBuyers = async (tokenAddress, minPercentage = 1, timeFrameHours = 1, mainContext = 'default') => {

    try {
        const tokenInfo = await dexScreenerApi.getTokenInfo(tokenAddress, mainContext);

        const creationTimestamp = Math.floor(tokenInfo.pairCreatedAt / 1000);
        const endTimestamp = creationTimestamp + (timeFrameHours * 3600);
        const totalSupply = Math.floor(parseFloat(tokenInfo.totalSupply) * Math.pow(10, tokenInfo.decimals));
        const minAmountRaw = (totalSupply * minPercentage) / 100;

        let cursor = null;
        let hasMoreEvents = true;
        const limit = 100;

        const earlyBuyers = new Map();

        while (hasMoreEvents) {
            try {
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

                if (!events || !events.items || events.items.length === 0) {
                    console.log("No more events to process");
                    break;
                }

                hasMoreEvents = processEvents(events, endTimestamp, earlyBuyers, tokenInfo);
                cursor = events.cursor;
                hasMoreEvents = hasMoreEvents && cursor !== null && events.items.length === limit;
            } catch (error) {
                console.error('Error fetching token events:', error);
                break;
            }
        }

        const qualifiedEarlyBuyers = new Map(
            Array.from(earlyBuyers.entries()).filter(([_, data]) => data.amount >= minAmountRaw)
        );

        const walletAddresses = Array.from(qualifiedEarlyBuyers.keys());
        const walletAnalysis = await fetchMultipleWallets(walletAddresses, 5, mainContext, 'fetchEarlyBuyers');

        const filteredEarlyBuyers = new Map();

        for (const [buyer, data] of qualifiedEarlyBuyers) {
            const walletData = walletAnalysis.find(w => w.wallet === buyer);
            if (walletData?.data?.data && !isBotWallet(walletData.data.data)) {
                filteredEarlyBuyers.set(buyer, {
                    ...data,
                    walletAddress: buyer,
                    walletInfo: walletData.data.data
                });
            } else {
                console.log(`Excluded bot wallet: ${buyer}`);
            }
        }

        return { 
            earlyBuyers: Array.from(filteredEarlyBuyers.values()),
            tokenInfo
        };

    } catch (error) {
        console.error(`Analysis failed for token ${tokenAddress}:`, error);
        throw error;
    }
};

module.exports = { analyzeEarlyBuyers };