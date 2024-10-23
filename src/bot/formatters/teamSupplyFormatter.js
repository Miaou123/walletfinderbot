// formatters/teamSupplyFormatter.js
const { formatNumber } = require('./generalFormatters');
const BigNumber = require('bignumber.js');
const logger = require('../../utils/logger');

const formatAddress = (address) => `<a href="https://solscan.io/account/${address}">${address.slice(0, 6)}...${address.slice(-4)}</a>`;

const getEmoji = (percentage) => {
    if (percentage <= 10) return '🟢';
    if (percentage <= 20) return '🟡';
    if (percentage <= 40) return '🟠';
    if (percentage <= 50) return '🔴';
    return '☠️';
};

const formatTeamSupplyResult = (analyzedWallets, tokenInfo, teamWallets, totalSupplyControlled) => {
    try {
        let message = `<b>Team Supply Analysis for <a href="https://dexscreener.com/solana/${tokenInfo.address}">${tokenInfo.symbol}</a></b>\n\n`;

        message += `👥 Supply Controlled by team/insiders: ${formatNumber(totalSupplyControlled, 2, true)} ${getEmoji(totalSupplyControlled)}\n`;
        message += `⚠️ Wallets flagged as team/insiders: ${teamWallets.length}\n\n`;
        message += `<b>Top team wallets:</b>\n`;

        const topTeamWallets = analyzedWallets
            .filter(w => w.category !== 'Unknown')
            .sort((a, b) => new BigNumber(b.balance).minus(new BigNumber(a.balance)).toNumber())
            .slice(0, 10);

        topTeamWallets.forEach((wallet, index) => {
            const supplyPercentage = new BigNumber(wallet.balance)
                .dividedBy(tokenInfo.totalSupply)
                .multipliedBy(100)
                .toFixed(2);
            message += `${index + 1}. ${formatAddress(wallet.address)} (${formatNumber(supplyPercentage, 2, true)}) - ${wallet.category}\n`;
        });

        return message;
    } catch (error) {
        logger.error('Error in formatWalletDetails:', error);
        return 'Error formatting wallet details.';
    }
};

const formatWalletDetails = (wallets, tokenInfo) => {
    try {
        let message = `<b><a href="https://dexscreener.com/solana/${tokenInfo.address}">${tokenInfo.symbol}</a></b>\n\n`;
        message += `<strong>${wallets.length} team addresses:</strong>\n\n`;

        const sortedWallets = [...wallets].sort((a, b) => 
            new BigNumber(b.balance).minus(new BigNumber(a.balance)).toNumber()
        );

        sortedWallets.forEach((wallet, index) => {
            const supplyPercentage = new BigNumber(wallet.balance)
                .dividedBy(tokenInfo.totalSupply)
                .multipliedBy(100);
            message += `${index + 1}. ${formatAddress(wallet.address)} (${formatNumber(supplyPercentage, 2, true)}) - ${wallet.category}\n`;
        });

        return message;
    } catch (error) {
        logger.error('Error in formatWalletDetails:', error);
        return 'Error formatting wallet details.';
}
};

module.exports = {
    formatTeamSupplyResult,
    formatWalletDetails
};