const { validateSolanaAddress } = require('../../utils/addressValidators');
const EntryPriceAnalyzer = require('../../analysis/entryPriceAnalyzer');
const { formatEntryMapResponse } = require('../formatters/entryMapFormatter');
const logger = require('../../utils/logger');

class EntryMapHandler {
    constructor(userManager, accessControl) {
        this.userManager = userManager;
        this.accessControl = accessControl;
        this.analyzer = new EntryPriceAnalyzer();
    }

    async handleCommand(bot, msg, args, messageThreadId) {
        if (!args || args.length < 1) {
            await bot.sendMessage(msg.chat.id, 
                "Please provide a token address.", 
                { message_thread_id: messageThreadId }
            );
            return;
        }

        const tokenAddress = args[0];
        const numHolders = args[1] ? parseInt(args[1]) : 20;

        if (!validateSolanaAddress(tokenAddress)) {
            await bot.sendMessage(msg.chat.id, 
                "Invalid token address format.", 
                { message_thread_id: messageThreadId }
            );
            return;
        }

        try {
            const statusMsg = await bot.sendMessage(
                msg.chat.id, 
                "⏳ Analyzing top holders entry prices...\nThis might take a few minutes.", 
                { message_thread_id: messageThreadId }
            );

            const entryMap = await this.analyzer.analyzeTokenEntries( // Utilisez this.analyzer ici
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
            logger.error('Error in entrymap command:', error);
            await bot.sendMessage(
                msg.chat.id, 
                "An error occurred while analyzing entry prices.", 
                { message_thread_id: messageThreadId }
            );
        }
    }
}

module.exports = EntryMapHandler;