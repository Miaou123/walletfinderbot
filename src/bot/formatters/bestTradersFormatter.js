const { formatNumber, truncateAddress, getEmojiForPnl } = require('./generalFormatters');

const MAX_MESSAGE_LENGTH = 4096; // Limite de caractères pour un message Telegram

function formatBestTraders(traders, sortOption) {
    const formattedTraders = traders.map((trader, index) => formatTrader(trader, index + 1, sortOption));
    return groupTraders(formattedTraders);
}

function formatTrader(trader, index, sortOption) {
    const { wallet, data } = trader;
    const { 
        winrate, 
        pnl_30d, 
        sol_balance, 
        total_value,
        unrealized_profit,
        realized_profit_30d,
    } = data.data;

    const winratePercentage = (winrate * 100).toFixed(2);
    const pnlEmoji = getEmojiForPnl(total_value);
    const truncatedWallet = truncateAddress(wallet);

    let formattedString = `${index}. <a href="https://solscan.io/account/${wallet}">${truncatedWallet}</a> ${pnlEmoji} <a href="https://gmgn.ai/sol/address/${wallet}">gmgn</a>/<a href="https://app.cielo.finance/profile/${wallet}/pnl/tokens">cielo</a>\n`;
    formattedString += `├ 💼 Port: $${formatNumber(total_value, 0)} (SOL: ${formatNumber(sol_balance, 2)})\n`;
    formattedString += `├ 💰 P/L (30d): $${formatNumber(realized_profit_30d, 0)} 📈 uP/L: $${formatNumber(unrealized_profit, 0)}\n`;
    formattedString += `└ 📊 Winrate (30d): ${winratePercentage}%`;

    // Add an indicator for the sort option
    const sortIndicator = getSortIndicator(sortOption);
    formattedString += ` ${sortIndicator}`;

    return formattedString;
}

function getSortIndicator(sortOption) {
    switch (sortOption.toLowerCase()) {
        case 'pnl':
            return '🏆';
        case 'winrate':
        case 'wr':
            return '🎯';
        case 'portfolio':
        case 'port':
            return '💼';
        case 'sol':
            return '☀️';
        default:
            return '';
    }
}

function groupTraders(formattedTraders) {
    const messages = [];
    let currentMessage = "";

    for (const trader of formattedTraders) {
        if (currentMessage.length + trader.length + 2 > MAX_MESSAGE_LENGTH) {
            messages.push(currentMessage.trim());
            currentMessage = trader + "\n\n";
        } else {
            currentMessage += trader + "\n\n";
        }
    }

    if (currentMessage) {
        messages.push(currentMessage.trim());
    }

    return messages;
}

module.exports = { formatBestTraders };