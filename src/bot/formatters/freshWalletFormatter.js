// formatters/freshWalletFormatter.js
const { formatNumber } = require('./generalFormatters');
const BigNumber = require('bignumber.js');
const logger = require('../../utils/logger');
const addressCategorization = require('../../utils/addressCategorization');

const formatAddress = (address) => `<a href="https://solscan.io/account/${address}">${address.slice(0, 6)}...${address.slice(-4)}</a>`;

const getEmoji = (percentage) => {
    if (percentage <= 10) return '🟢';
    if (percentage <= 20) return '🟡';
    if (percentage <= 40) return '🟠';
    if (percentage <= 50) return '🔴';
    return '☠️';
};

/**
 * Format the time difference between now and a past timestamp
 * @param {number} timestamp - Unix timestamp in seconds
 * @returns {string} - Formatted time difference (e.g., "2d ago")
 */
const formatTimeDifference = (timestamp) => {
    if (!timestamp) return '';
    
    const now = Math.floor(Date.now() / 1000);
    const seconds = now - timestamp;
    
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;
    if (seconds < 31536000) return `${Math.floor(seconds / 2592000)}mo ago`;
    return `${Math.floor(seconds / 31536000)}y ago`;
};

/**
 * Format funding source information with clickable links
 * @param {string} funderAddress - Address of the funding source
 * @param {Object} fundingDetails - Details about the funding
 * @returns {string} - Formatted funding information
 */
const formatFundingInfo = (funderAddress, fundingDetails) => {
    if (!funderAddress || !fundingDetails) return '';
    
    const fundingAmount = fundingDetails.amount ? `${fundingDetails.amount.toFixed(2)} SOL` : '';
    const txSignature = fundingDetails.signature || '';
    
    // Get source name from details or address categorization
    let sourceName = fundingDetails.sourceName;
    if (!sourceName) {
        const addressInfo = addressCategorization.getAddressInfo(funderAddress);
        sourceName = addressInfo ? addressInfo.name : null;
    }
    
    const timeAgo = fundingDetails.timestamp ? formatTimeDifference(fundingDetails.timestamp) : '';
    
    // Format the transaction link
    const txLink = txSignature ? 
        `<a href="https://solscan.io/tx/${txSignature}">funded</a>` : 
        'funded';
    
    // Format funding info in a clean way with clickable links
    if (fundingAmount && sourceName) {
        // Make the source name clickable
        return ` | ${txLink} ${fundingAmount} from <a href="https://solscan.io/account/${funderAddress}">${sourceName}</a> ${timeAgo}`;
    } else if (fundingAmount) {
        return ` | ${txLink} ${fundingAmount} from ${formatAddress(funderAddress)} ${timeAgo}`;
    }
    
    return '';
};

const formatFreshWalletsResult = (analyzedWallets, tokenInfo, freshWallets, totalSupplyControlled) => {
    try {
        let message = `<b>Fresh Wallets Analysis for <a href="https://dexscreener.com/solana/${tokenInfo.address}">${tokenInfo.symbol}</a></b>\n\n`;

        message += `🔥 Supply Controlled by Fresh Wallets: ${formatNumber(totalSupplyControlled, 2, true)} ${getEmoji(totalSupplyControlled)}\n`;
        message += `⚠️ Fresh Wallets Detected: ${freshWallets.length}\n\n`;
        message += `<b>Top Fresh Wallets:</b>\n`;

        const topFreshWallets = analyzedWallets
            .filter(w => w.category === 'Fresh')
            .sort((a, b) => new BigNumber(b.balance).minus(new BigNumber(a.balance)).toNumber())
            .slice(0, 10);

        topFreshWallets.forEach((wallet, index) => {
            const supplyPercentage = new BigNumber(wallet.balance)
                .dividedBy(tokenInfo.totalSupply)
                .multipliedBy(100)
                .toFixed(2);
                
            // Basic wallet info
            let walletLine = `${index + 1}. ${formatAddress(wallet.address)} (${formatNumber(supplyPercentage, 2, true)})`;
            
            // Add funding info if available
            walletLine += formatFundingInfo(wallet.funderAddress, wallet.fundingDetails);
            
            message += `${walletLine}\n`;
        });

        return message;
    } catch (error) {
        logger.error('Error in formatFreshWalletsResult:', error);
        return 'Error formatting fresh wallets details.';
    }
};

function formatWalletDetails(analyzedWallets, tokenInfo) {
    const freshWallets = analyzedWallets.filter(wallet => wallet.category === 'Fresh');

    let message = `<b>${tokenInfo.symbol}</b> (<a href="https://dexscreener.com/solana/${tokenInfo.address}">📈</a>)\n`;
    message += `<b>${freshWallets.length} fresh wallet addresses:</b>\n\n`;

    freshWallets
        .sort((a, b) => {
            const balanceA = new BigNumber(a.balance).dividedBy(tokenInfo.totalSupply).multipliedBy(100);
            const balanceB = new BigNumber(b.balance).dividedBy(tokenInfo.totalSupply).multipliedBy(100);
            return balanceB.minus(balanceA).toNumber();
        })
        .forEach((wallet, index) => {
            const percentage = new BigNumber(wallet.balance)
                .dividedBy(tokenInfo.totalSupply)
                .multipliedBy(100)
                .toFixed(2);

            // Basic wallet info
            let walletLine = `${index + 1}. ${formatAddress(wallet.address)} (${percentage}%)`;
            
            // Add funding info if available
            if (wallet.funderAddress && wallet.fundingDetails) {
                const fundingAmount = wallet.fundingDetails.amount ? `${wallet.fundingDetails.amount.toFixed(2)} SOL` : '';
                const txSignature = wallet.fundingDetails.signature || '';
                
                // Get source name from details or address categorization
                let sourceName = wallet.fundingDetails.sourceName;
                if (!sourceName) {
                    const addressInfo = addressCategorization.getAddressInfo(wallet.funderAddress);
                    sourceName = addressInfo ? addressInfo.name : null;
                }
                
                const timeAgo = wallet.fundingDetails.timestamp ? formatTimeDifference(wallet.fundingDetails.timestamp) : '';
                
                // Format the transaction link
                const txLink = txSignature ? 
                    `<a href="https://solscan.io/tx/${txSignature}">funded</a>` : 
                    'funded';
                
                let fundingInfo = '';
                
                if (fundingAmount && sourceName) {
                    fundingInfo = `\n   └ ${txLink} ${fundingAmount} from <a href="https://solscan.io/account/${wallet.funderAddress}">${sourceName}</a> ${timeAgo}`;
                } else if (fundingAmount) {
                    fundingInfo = `\n   └ ${txLink} ${fundingAmount} from ${formatAddress(wallet.funderAddress)} ${timeAgo}`;
                }
                
                walletLine += fundingInfo;
            }
            
            message += `${walletLine}\n\n`;
        });

    return message;
}

module.exports = {
    formatFreshWalletsResult,
    formatWalletDetails,
    formatTimeDifference,
    formatFundingInfo
};