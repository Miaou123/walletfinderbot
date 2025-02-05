const { validateSolanaAddress } = require('./helpers');
const logger = require('../../utils/logger');
const gmgnApi = require('../../integrations/gmgnApi');

class WalletCheckerHandler {
    constructor() {
        this.COMMAND_NAME = 'walletchecker';
        this.VALID_PERIODS = ['1d', '7d', '30d'];
    }

    formatDuration(minutes) {
        const days = Math.floor(minutes / 1440);
        const hours = Math.floor((minutes % 1440) / 60);
        const remainingMinutes = minutes % 60;

        let result = '';
        if (days > 0) result += `${days}d `;
        if (hours > 0) result += `${hours}h `;
        if (remainingMinutes > 0) result += `${remainingMinutes}m`;
        
        return result.trim();
    }

    formatMoney(amount) {
        if (amount === undefined || amount === null) {
            return '$0';
        }
        amount = Number(amount);
        if (isNaN(amount)) {
            return '$0';
        }
        if (amount >= 1000000) {
            return `$${(amount / 1000000).toFixed(1)}M`;
        } else if (amount >= 1000) {
            return `$${(amount / 1000).toFixed(1)}K`;
        }
        return `$${amount.toFixed(0)}`;
    }

    formatWalletData(walletData, address, period) {
        try {
            if (!walletData || typeof walletData !== 'object') {
                throw new Error('Invalid wallet data received');
            }

            logger.info('Raw wallet data:', JSON.stringify(walletData, null, 2));

            const holdingPeriod = Math.floor(Number(walletData.avg_holding_peroid || 0) / 60);
            const formattedHoldingPeriod = this.formatDuration(holdingPeriod);
            const totalProfitUSD = Number(walletData.total_profit || 0);
            const totalProfitPct = ((Number(walletData.total_profit_pnl || 0)) * 100).toFixed(2);
            const pnl7d = ((Number(walletData.pnl_7d || 0)) * 100).toFixed(2);
            const pnl30d = ((Number(walletData.pnl_30d || 0)) * 100).toFixed(2);

            const linkSolscan = `https://solscan.io/account/${address}`;
            const linkBirdeye = `https://birdeye.so/profile/${address}`;
            const linkGmgn = `https://gmgn.ai/sol/address/${address}`;

            const periodSuffix = period ? ` (${period})` : '';

            return `📊 Wallet Analysis
🔗 [Solscan](${linkSolscan}) | [Birdeye](${linkBirdeye}) | [Gmgn](${linkGmgn})

🏦 Balance: \`${parseFloat(walletData.sol_balance || 0).toFixed(2)}\` SOL

*📊 Performance:*
💵 Total PnL: \`${this.formatMoney(totalProfitUSD)} (${totalProfitPct > 0 ? '+' : ''}${totalProfitPct}%)\`
7D PnL: \`${pnl7d > 0 ? '+' : ''}${pnl7d}%\`
30D PnL: \`${pnl30d > 0 ? '+' : ''}${pnl30d}%\`
🏆 WinRate: \`${(Number(walletData.winrate || 0) * 100).toFixed(0)}%\`

*📈 Trading Activity${periodSuffix}:*
📈 Avg Trades Per Day: \`${((Number(walletData.buy_30d || 0) + Number(walletData.sell_30d || 0)) / 30).toFixed(1)}\`
🛒 Avg Trade Buys/Sells: \`${(Number(walletData.buy_30d || 0) / 30).toFixed(1)}\` / \`${(Number(walletData.sell_30d || 0) / 30).toFixed(1)}\`
🛒 Avg Buy Size: \`${this.formatMoney(walletData.token_avg_cost)}\`
💰 Avg Profit: \`${this.formatMoney(walletData.token_sold_avg_profit)}\`
⏪ Last Trade: \`${Math.floor((Date.now()/1000 - (walletData.last_active_timestamp || 0)) / 3600)}h\` ago

*📈 Trade Stats${periodSuffix}:*
↕️ Total Trades: \`${walletData.token_num || 0}\`
⬆️ Win Trades: \`${walletData.profit_num || 0}\`
🚀 >500%: \`${walletData.pnl_gt_5x_num || 0} (${(((walletData.pnl_gt_5x_num || 0) / (walletData.token_num || 1)) * 100).toFixed(2)}%)\`
💫 200%-500%: \`${walletData.pnl_2x_5x_num || 0} (${(((walletData.pnl_2x_5x_num || 0) / (walletData.token_num || 1)) * 100).toFixed(2)}%)\`
✨ 0%-200%: \`${walletData.pnl_lt_2x_num || 0} (${(((walletData.pnl_lt_2x_num || 0) / (walletData.token_num || 1)) * 100).toFixed(2)}%)\`
🌧️ 0%~-50%: \`${walletData.pnl_minus_dot5_0x_num || 0} (${(((walletData.pnl_minus_dot5_0x_num || 0) / (walletData.token_num || 1)) * 100).toFixed(2)}%)\`
⛈️ <-50%: \`${walletData.pnl_lt_minus_dot5_num || 0} (${(((walletData.pnl_lt_minus_dot5_num || 0) / (walletData.token_num || 1)) * 100).toFixed(2)}%)\`

*⚠️ Risk Metrics${periodSuffix}:*
🚩 Scam Tokens: \`${walletData.risk?.token_honeypot || 0} (${((Number(walletData.risk?.token_honeypot_ratio || 0)) * 100).toFixed(0)}%)\`
⚡ Fast Trades < 1 min: \`${walletData.risk?.fast_tx || 0} (${((Number(walletData.risk?.fast_tx_ratio || 0)) * 100).toFixed(0)}%)\`

_You can change the timeframe by adding 1d / 7d or 30d at the end of your command (default is 30d)_`;
        } catch (error) {
            logger.error('Error formatting wallet data:', error);
            throw error;
        }
    }

    async handleCommand(bot, msg, args) {
        try {
            if (!args || args.length === 0) {
                await bot.sendMessage(msg.chat.id, 'Please provide a wallet address to analyze.');
                return;
            }

            let address = args[0];
            let period = '30d'; // Default period

            // Check if a period is specified
            if (args.length > 1) {
                const requestedPeriod = args[1].toLowerCase();
                if (this.VALID_PERIODS.includes(requestedPeriod)) {
                    period = requestedPeriod;
                } else {
                    await bot.sendMessage(msg.chat.id, `Invalid period. Please use one of: ${this.VALID_PERIODS.join(', ')}`);
                    return;
                }
            }

            if (!validateSolanaAddress(address)) {
                await bot.sendMessage(msg.chat.id, "Invalid Solana address. Please provide a valid Solana address.");
                return;
            }

            const loadingMsg = await bot.sendMessage(msg.chat.id, '🔍 Analyzing wallet...');
            
            const response = await gmgnApi.getWalletData(address, 'wallet', 'analyze', period);
            
            if (!response || !response.data) {
                await bot.editMessageText('Error analyzing wallet. Please try again later.', {
                    chat_id: msg.chat.id,
                    message_id: loadingMsg.message_id
                });
                return;
            }

            const formattedMessage = this.formatWalletData(response.data, address, period);
            await bot.deleteMessage(msg.chat.id, loadingMsg.message_id);

            await bot.sendMessage(msg.chat.id, formattedMessage, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            });

        } catch (error) {
            logger.error('Error in wallet command:', error);
            throw error;
        }
    }
}

module.exports = WalletCheckerHandler;