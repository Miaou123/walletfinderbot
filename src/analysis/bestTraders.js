const gmgnApi = require('../integrations/gmgnApi');
const { fetchMultipleWallets } = require('../tools/walletChecker');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});

async function analyzeBestTraders(contractAddress, winrateThreshold = 30, portfolioThreshold = 1000, sortOption = 'winrate', mainContext = 'bestTraders') {
    try {
        const tradersData = await gmgnApi.getTopTraders(contractAddress, mainContext, 'analyzeBestTraders');
        const traders = tradersData.data;
        logger.info(`Fetched ${traders.length} top traders`);

        const traderAddresses = traders.map(trader => trader.address);
        const walletData = await fetchMultipleWallets(traderAddresses, 10, mainContext, 'analyzeBestTraders');
        
        const bestTraders = walletData.filter(wallet => {
            if (wallet && wallet.data && wallet.data.data) {
                const winrate = wallet.data.data.winrate * 100;
                const portfolioValue = wallet.data.data.total_value;
                return winrate > winrateThreshold && portfolioValue > portfolioThreshold;
            }
            return false;
        });

        // Sort the bestTraders array based on the sortOption
        bestTraders.sort((a, b) => {
            switch (sortOption.toLowerCase()) {
                case 'pnl':
                    return b.data.data.realized_profit_30d - a.data.data.realized_profit_30d;
                case 'winrate':
                case 'wr':
                    return b.data.data.winrate - a.data.data.winrate;
                case 'portfolio':
                case 'port':
                    return b.data.data.total_value - a.data.data.total_value;
                case 'sol':
                    return b.data.data.sol_balance - a.data.data.sol_balance;
                default:
                    return b.data.data.winrate - a.data.data.winrate;
            }
        });

        logger.info(`Found ${bestTraders.length} traders with winrate > ${winrateThreshold}% and portfolio value > $${portfolioThreshold}, sorted by ${sortOption}`);

        return bestTraders;
    } catch (error) {
        logger.error(`Error in analyzeBestTraders: ${error.message}`);
        throw error;
    }
}

module.exports = { analyzeBestTraders };