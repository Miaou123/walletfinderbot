const { recognizeArgType } = require('./helpers.js');
const dexscreenerApi = require('../../integrations/dexScreenerApi');
const { formatDexPaidResponse } = require('../formatters/dexPaidFormatter');
const logger = require('../../utils/logger');
const ActiveCommandsTracker = require('../commandsManager/activeCommandsTracker');

class DexPaidHandler {
    constructor(userManager, accessControl) {
        this.userManager = userManager;
        this.accessControl = accessControl;
        this.COMMAND_NAME = 'dexpaid';
    }

    async handleCommand(bot, msg, args, messageThreadId) {
        const userId = msg.from.id;
        logger.info(`Starting DexPaid command for user ${msg.from.username}`);

        try {
            if (!ActiveCommandsTracker.canAddCommand(userId, this.COMMAND_NAME)) {
                await bot.sendMessage(msg.chat.id,
                    "You already have 3 active commands. Please wait for them to complete.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }

            if (!ActiveCommandsTracker.addCommand(userId, this.COMMAND_NAME)) {
                await bot.sendMessage(msg.chat.id,
                    "Unable to add a new command at this time.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }

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
            await bot.sendMessage(msg.chat.id,
                "An error occurred while checking the DexScreener status.",
                { message_thread_id: messageThreadId }
            );
        } finally {
            this._finalizeCommand(userId);
        }
    }

    _finalizeCommand(userId) {
        logger.debug('DexPaid command completed');
        ActiveCommandsTracker.removeCommand(userId, this.COMMAND_NAME);
    }
}

module.exports = DexPaidHandler;