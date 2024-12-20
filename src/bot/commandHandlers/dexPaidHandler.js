const { recognizeArgType } = require('./helpers.js');
const dexscreenerApi = require('../../integrations/dexScreenerApi');
const { formatDexPaidResponse } = require('../formatters/dexPaidFormatter');
const logger = require('../../utils/logger');

class DexPaidHandler {
    constructor() {
        this.COMMAND_NAME = 'dexpaid';
    }

    async handleCommand(bot, msg, args, messageThreadId) {
        const userId = msg.from.id;
        logger.info(`Starting DexPaid command for user ${msg.from.username}`);

        try {
            let tokenAddress;
            args.forEach(arg => {
                const { type, value } = recognizeArgType(arg);
                if (type === 'solanaAddress') {
                    tokenAddress = value;
                }
            });

            if (!tokenAddress) {
                await bot.sendMessage(msg.chat.id,
                    "Please provide a token address.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }

            const statusMsg = await bot.sendMessage(msg.chat.id,
                "⏳ Checking DexScreener status...",
                { message_thread_id: messageThreadId }
            );

            const [orders, tokenInfo] = await Promise.all([
                dexscreenerApi.getTokenOrders(tokenAddress),
                dexscreenerApi.getTokenInfo(tokenAddress)
            ]);

            const formattedResponse = formatDexPaidResponse(orders, tokenInfo);

            await bot.editMessageText(formattedResponse, {
                chat_id: msg.chat.id,
                message_id: statusMsg.message_id,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });

        } catch (error) {
            logger.error('Error in dexpaid command:', error);
            throw error;
        }
    }
}

module.exports = DexPaidHandler;