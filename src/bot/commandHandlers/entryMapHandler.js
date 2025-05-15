const { validateSolanaAddress, recognizeArgType } = require('./helpers.js');
const EntryPriceAnalyzer = require('../../analysis/entryPriceAnalyzer');
const { formatEntryMapResponse } = require('../formatters/entryMapFormatter');
const logger = require('../../utils/logger');
const { tokenGatedCommand } = require('../../utils/tokenGateMiddleware');

class EntryMapHandler {
    constructor() {
        this.analyzer = new EntryPriceAnalyzer();
        this.COMMAND_NAME = 'entrymap';
    }

    async handleCommand(bot, msg, args, messageThreadId) {
        const userId = msg.from.id;
        logger.info(`Starting EntryMap command for user ${msg.from.username}`);

        try {
            if (!args || args.length < 1) {
                await bot.sendMessage(msg.chat.id,
                    "Please provide a token address.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }

            let tokenAddress, numHolders = 20;

            args.forEach(arg => {
                const { type, value } = recognizeArgType(arg);
                if (type === 'solanaAddress') {
                    tokenAddress = value;
                } else if (type === 'number') {
                    numHolders = parseInt(value);
                }
            });

            if (!validateSolanaAddress(tokenAddress)) {
                await bot.sendMessage(msg.chat.id,
                    "Invalid token address format.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }

            const statusMsg = await bot.sendMessage(msg.chat.id,
                "⏳ Analyzing top holders entry prices...\nThis might take a few minutes.",
                { message_thread_id: messageThreadId }
            );

            const entryMap = await this.analyzer.analyzeTokenEntries(
                tokenAddress,
                numHolders,
                'entrymap',
                msg.from.username
            );

            const formattedResponse = formatEntryMapResponse(entryMap);

            await bot.editMessageText(formattedResponse, {
                chat_id: msg.chat.id,
                message_id: statusMsg.message_id,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });
        } catch (error) {
            logger.error('Error in Entry map command:', error);
            throw error;
        }
    }

    _finalizeCommand(userId) {
        logger.debug('EntryMap command completed');
        ActiveCommandsTracker.removeCommand(userId, this.COMMAND_NAME);
    }
}

module.exports = EntryMapHandler;
