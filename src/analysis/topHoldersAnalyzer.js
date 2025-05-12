const { getSolanaApi } = require('../integrations/solanaApi');
const { checkInactivityPeriod } = require('../tools/inactivityPeriod');
const { getAssetsForMultipleWallets } = require('../tools/walletValueCalculator');
const { getTopHolders } = require('../tools/getHolders');
const { fetchMultipleWallets } = require('../tools/walletChecker');
const config = require('../utils/config');
const BigNumber = require('bignumber.js');
const logger = require('../utils/logger');

class TokenAnalyzer {
    constructor() {
        this.solanaApi = getSolanaApi();
    }

    async analyzeToken(coinAddress, count, mainContext = 'default') {
        try {
            logger.debug('Fetching token metadata...');
            const tokenMetadata = await this.solanaApi.getAsset(coinAddress, mainContext, 'getAsset');
            
            if (!tokenMetadata) {
                throw new Error("No token metadata found");
            }

            logger.debug('Token metadata received:', { tokenMetadata });

            const formattedTokenInfo = this.formatTokenInfo(tokenMetadata, coinAddress);
            const topHolders = await getTopHolders(coinAddress, count, mainContext, 'getTopHolders');
            
            // Ensure each holder has tokenBalance and tokens are properly formatted
            const walletInfos = topHolders.map(holder => ({ 
                address: holder.address, 
                tokenBalance: holder.tokenBalance,
                // Convert to number if it's a string
                amount: typeof holder.balance === 'string' ? parseFloat(holder.balance) : holder.balance,
                solBalance: holder.solBalance || '0'
            }));

            const analyzedWallets = await this.analyzeAndFormatMultipleWallets(
                walletInfos, 
                coinAddress, 
                formattedTokenInfo, 
                mainContext
            );

            return { 
                tokenInfo: formattedTokenInfo, 
                analyzedWallets 
            };

        } catch (error) {
            logger.error('Error analyzing token:', { coinAddress, error: error.message });
            throw error;
        }
    }

    formatTokenInfo(tokenMetadata, coinAddress) {
        return {
            decimals: tokenMetadata.decimals,
            symbol: tokenMetadata.symbol,
            name: tokenMetadata.name,
            address: coinAddress,
            price: tokenMetadata.price,
            total_supply: tokenMetadata.supply.total,
            market_cap: tokenMetadata.price * tokenMetadata.supply.total,
        };
    }

    async analyzeAndFormatMultipleWallets(walletInfos, coinAddress, tokenInfo, mainContext) {
        try {
            const walletAddresses = walletInfos.map(info => info.address);
            const assetsData = await getAssetsForMultipleWallets(walletAddresses, mainContext, 'getAssets');

            return Promise.all(walletInfos.map(walletInfo => 
                this.fetchAndFormatWalletData(walletInfo, assetsData, coinAddress, tokenInfo, mainContext)
            ));
        } catch (error) {
            console.error('Error in analyzeAndFormatMultipleWallets:', error);
            throw error;
        }
    }

    async fetchAndFormatWalletData(walletInfo, assetsData, coinAddress, tokenInfo, mainContext) {
        try {
            let stats = assetsData[walletInfo.address];
            if (!stats) return this.generateErrorObject(walletInfo.address, 'No data found');

            const specificTokenInfo = stats.tokenInfos.find(t => t.mint === coinAddress);
            const analyzedTokenValue = specificTokenInfo ? parseFloat(specificTokenInfo.value) : 0;
            const walletValueExcludingAnalyzedToken = parseFloat(stats.totalValue) - analyzedTokenValue;

            // Calculate supply percentage - ensure we have valid numbers
            let tokenBalance = new BigNumber(walletInfo.tokenBalance || 0);
            let totalSupply = new BigNumber(tokenInfo.total_supply || 0);
            let supplyPercentage = this.calculateSupplyPercentage(tokenBalance, totalSupply);

            const { isInteresting, category } = await this.determineWalletCategory(
                walletInfo.address,
                walletValueExcludingAnalyzedToken,
                stats,
                coinAddress,
                mainContext
            );

            // Bundle token information
            const tokenValueUsd = specificTokenInfo ? specificTokenInfo.value : 'N/A';
            
            // Create formatted info string for display
            const formattedInfo = `${tokenBalance.toFormat(0)} ${tokenInfo.symbol}, ${supplyPercentage}% of supply, $${tokenValueUsd} - ${stats.solBalance} SOL - ${stats.daysSinceLastRelevantSwap || 'N/A'} days since last relevant swap`;

            if (isInteresting && category === 'High Value') {
                const walletCheckerData = await fetchMultipleWallets(
                    [walletInfo.address], 
                    1, 
                    mainContext, 
                    'walletChecker'
                );
                if (walletCheckerData && walletCheckerData[0]) {
                    return this.enrichWalletInfo(
                        walletInfo,
                        walletCheckerData[0],
                        category,
                        stats,
                        formattedInfo,
                        supplyPercentage,
                        tokenValueUsd,
                        tokenBalance.toFormat(0),
                        tokenInfo.symbol,
                        tokenBalance
                    );
                }
            }

            return this.generateResultObject(
                walletInfo.address,
                isInteresting,
                category,
                stats,
                formattedInfo,
                supplyPercentage,
                tokenValueUsd,
                tokenBalance.toFormat(0),
                tokenInfo.symbol,
                tokenBalance
            );
        } catch (error) {
            console.error(`Error analyzing wallet ${walletInfo.address}:`, error);
            return this.generateErrorObject(walletInfo.address, 'Failed to analyze');
        }
    }

    async determineWalletCategory(address, walletValue, stats, coinAddress, mainContext) {
        if (walletValue > config.HIGH_WALLET_VALUE_THRESHOLD) {
            return { isInteresting: true, category: 'High Value' };
        }

        const transactionCount = await this.getTransactionCountIfNeeded(address, stats, mainContext);
        if (transactionCount < config.LOW_TRANSACTION_THRESHOLD) {
            return { isInteresting: true, category: 'Low Transactions' };
        }

        const inactivityCheck = await checkInactivityPeriod(
            address, 
            coinAddress, 
            mainContext, 
            'checkInactivity'
        );
        if (inactivityCheck.isInactive) {
            stats.daysSinceLastRelevantSwap = inactivityCheck.daysSinceLastActivity;
            return { isInteresting: true, category: 'Inactive' };
        }

        return { isInteresting: false, category: '' };
    }

    async getTransactionCountIfNeeded(address, stats, mainContext) {
        const transactions = await this.solanaApi.getSignaturesForAddress(
            address, 
            { limit: config.LOW_TRANSACTION_THRESHOLD }, 
            mainContext, 
            'getSignatures'
        );
        stats.transactionCount = transactions.length;
        return transactions.length;
    }

    calculateSupplyPercentage(balance, totalSupply) {
        if (!totalSupply || totalSupply.isNaN() || totalSupply.isZero()) {
            return 'N/A';
        }
        
        if (!balance || balance.isNaN()) {
            return 'N/A';
        }
        
        return balance.dividedBy(totalSupply).multipliedBy(100).toFixed(2);
    }

    generateResultObject(address, isInteresting, category, stats, formattedInfo, supplyPercentage, tokenValueUsd, tokenBalanceFormatted, tokenSymbol, tokenBalance) {
        return {
            address,
            isInteresting,
            category,
            stats,
            formattedInfo,
            supplyPercentage,
            tokenValueUsd,
            tokenBalance: tokenBalanceFormatted,
            rawTokenBalance: tokenBalance, // Added for formatter flexibility
            tokenSymbol,
            solBalance: stats.solBalance,
            daysSinceLastRelevantSwap: stats.daysSinceLastRelevantSwap || 'N/A'
        };
    }

    generateErrorObject(address, error) {
        return { 
            address, 
            isInteresting: false, 
            error 
        };
    }

    enrichWalletInfo(walletInfo, walletCheckerData, category, stats, formattedInfo, supplyPercentage, tokenValueUsd, tokenBalanceFormatted, tokenSymbol, tokenBalance) {
        const { winrate, realized_profit_30d, unrealized_profit } = walletCheckerData.data.data;
        return {
            address: walletInfo.address,
            isInteresting: true,
            category,
            stats,
            formattedInfo,
            supplyPercentage,
            tokenValueUsd,
            tokenBalance: tokenBalanceFormatted,
            rawTokenBalance: tokenBalance, // Added for formatter flexibility
            tokenSymbol,
            solBalance: stats.solBalance,
            daysSinceLastRelevantSwap: stats.daysSinceLastRelevantSwap || 'N/A',
            winrate: winrate * 100,
            pnl30d: realized_profit_30d,
            unrealizedPnl: unrealized_profit
        };
    }
}

module.exports = TokenAnalyzer;