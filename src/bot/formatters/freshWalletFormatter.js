// formatters/freshWalletFormatter.js
const { formatNumber } = require('./generalFormatters');
const BigNumber = require('bignumber.js');
const logger = require('../../utils/logger');
const unifiedFormatter = require('./unifiedFormatter');

const getEmoji = (percentage) => {
    if (percentage <= 10) return '🟢';
    if (percentage <= 20) return '🟡';
    if (percentage <= 40) return '🟠';
    if (percentage <= 50) return '🔴';
    return '☠️';
};

const formatFreshWalletsResult = (analyzedWallets, tokenInfo, freshWallets, totalSupplyControlled) => {
    try {
        return unifiedFormatter.formatWalletAnalysis(
            analyzedWallets, 
            tokenInfo,
            freshWallets,
            totalSupplyControlled,
            {
                title: 'Fresh Wallets Analysis',
                emoji: '🔥',
                warningEmoji: '⚠️',
                walletType: 'fresh',
                categoryFilter: 'Fresh',
                displayCategory: false,
                maxWallets: 10
            }
        );
    } catch (error) {
        logger.error('Error in formatFreshWalletsResult:', error);
        return 'Error formatting fresh wallets details.';
    }
};

function formatWalletDetails(analyzedWallets, tokenInfo) {
    try {
        return unifiedFormatter.formatWalletDetails(
            analyzedWallets,
            tokenInfo,
            {
                categoryFilter: 'Fresh',
                displayCategory: false,
                walletType: 'fresh wallet'
            }
        );
    } catch (error) {
        logger.error('Error in formatWalletDetails:', error);
        return 'Error formatting fresh wallet details.';
    }
}

module.exports = {
    formatFreshWalletsResult,
    formatWalletDetails,
    // Export these for backward compatibility if needed elsewhere
    formatTimeDifference: unifiedFormatter.formatTimeDifference.bind(unifiedFormatter),
    formatFundingInfo: unifiedFormatter.formatFundingInfo.bind(unifiedFormatter)
};