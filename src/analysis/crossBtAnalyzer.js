const gmgnApi = require('../integrations/gmgnApi');
const { fetchMultipleWallets } = require('../tools/walletChecker');
const logger = require('../utils/logger');
const PoolAndBotDetector  = require('../tools/poolAndBotDetector');

class CrossBtAnalyzer {
    constructor() {
        this.detector = new PoolAndBotDetector();
    }
    
    async analyze(tokenAddresses) {
        logger.info(`Starting analysis for tokens: ${tokenAddresses.join(', ')}`);

        const topTradersPromises = tokenAddresses.map(address => 
            gmgnApi.getTopTraders(address, 'crossBt', `getTopTraders_${address}`)
        );

        const topTradersResults = await Promise.all(topTradersPromises);
        logger.info(`Received top traders data for ${topTradersResults.length} tokens`);

        const commonTraders = this.findCommonTraders(topTradersResults);
        logger.info(`Found ${commonTraders.length} common traders`);

        const walletCheckerData = await this.getWalletCheckerData(commonTraders);
        logger.info(`Retrieved wallet checker data for ${walletCheckerData.length} traders`);

        const analyzedWallets = await Promise.all(
            walletCheckerData.map(wallet => this.detector.analyzeWallet(wallet, 'crossBt'))
        );
        logger.info(`Analyzed ${analyzedWallets.length} wallets`);

        const results = this.prepareAnalysisResults(commonTraders, analyzedWallets, tokenAddresses, topTradersResults);
        logger.debug(`Prepared analysis results: ${JSON.stringify(results)}`);
        return results;
    }

    findCommonTraders(topTradersResults) {
        logger.debug(`Entering findCommonTraders with ${topTradersResults.length} results`);
        
        const traderSets = topTradersResults.map((result, index) => {
            //logger.debug(`Processing result ${index + 1}: ${JSON.stringify(result)}`);
            if (!result || !result.data || !Array.isArray(result.data)) {
                logger.error(`Invalid result structure for token ${index + 1}`);
                return new Set();
            }
            const traders = result.data.map(trader => trader.address).filter(address => address);
            logger.debug(`Traders for token ${index + 1}: ${JSON.stringify(traders)}`);
            return new Set(traders);
        });
    
        logger.debug(`Trader sets created: ${traderSets.map(set => Array.from(set).join(', ')).join(' | ')}`);
    
        if (traderSets.length === 0 || traderSets.some(set => set.size === 0)) {
            logger.warn('One or more trader sets are empty');
            return [];
        }
    
        const commonTraders = [...traderSets[0]].filter(wallet => 
            traderSets.every(set => set.has(wallet))
        );
    
        logger.info(`Common traders found: ${commonTraders.length}`);
        logger.debug(`Common traders: ${JSON.stringify(commonTraders)}`);
        
        return commonTraders;
    }

    async getWalletCheckerData(commonTraders) {
        try {
            const walletCheckerData = await fetchMultipleWallets(commonTraders, 5, 'crossBt', 'walletChecker');
            return walletCheckerData;
        } catch (error) {
            logger.error('Error fetching wallet checker data:', error);
            return [];
        }
    }

    prepareAnalysisResults(commonTraders, analyzedWallets, tokenAddresses, topTradersResults) {
        logger.info('Preparing analysis results');
    
        const traderDetails = commonTraders.map(wallet => {
            const walletData = analyzedWallets.find(data => data.wallet === wallet);
    
            const traderInfo = tokenAddresses.map((address, index) => {
                const traderData = topTradersResults[index].data.find(t => t.wallet === wallet || t.address === wallet);
                
                const profit = traderData?.profit || 0;
                const buyVolume = traderData?.buy_volume_cur || 1;
                const pnlPercentage = ((profit / buyVolume) * 100).toFixed(2);
    
                return {
                    tokenAddress: address,
                    pnl: profit,
                    pnlPercentage: pnlPercentage
                };
            });
    
            return {
                address: wallet,
                walletCheckerData: walletData?.data?.data,
                walletType: walletData?.type,
                walletSubType: walletData?.subType,
                isBot: walletData?.type === 'bot',
                traderInfo: traderInfo
            };
        });
    
        return {
            commonTraders: traderDetails,
            tokenAddresses: tokenAddresses,
        };
    }
}

module.exports = CrossBtAnalyzer;