const { validateSolanaAddress } = require('../../utils/addressValidators');
const dexscreenerApi = require('../../integrations/dexScreenerApi');
const { formatDexPaidResponse  } = require('../formatters/dexPaidFormatter');


class DexPaidHandler {
    constructor(userManager, accessControl) {
        this.userManager = userManager;
        this.accessControl = accessControl;
    }

    async handleCommand(bot, msg, args, messageThreadId) {
        if (!args || args.length === 0) {
            await bot.sendMessage(msg.chat.id, "Please provide a token address.", { message_thread_id: messageThreadId });
            return;
        }

        const tokenAddress = args[0];
        
        if (!validateSolanaAddress(tokenAddress)) {
            await bot.sendMessage(msg.chat.id, "Invalid token address format.", { message_thread_id: messageThreadId });
            return;
        }

        try {
            const statusMsg = await bot.sendMessage(msg.chat.id, "⏳ Checking DexScreener status...", { message_thread_id: messageThreadId });

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
            console.error('Error in dexpaid command:', error);
            await bot.sendMessage(msg.chat.id, "An error occurred while checking the DexScreener status.", { message_thread_id: messageThreadId });
        }
    }
}

module.exports = DexPaidHandler;