const UnifiedBundleAnalyzer = require('../../analysis/bundle');
const { formatMainMessage, formatNonPumpfunBundleResponse } = require('../formatters/bundleFormatter');
const logger = require('../../utils/logger');
const { validateSolanaAddress } = require('./helpers');

class BundleHandler {
    constructor() {
        this.bundleAnalyzer = new UnifiedBundleAnalyzer();
        this.COMMAND_NAME = 'bundle';
    }

    async handleCommand(bot, msg, args, messageThreadId) {
        const username = msg.from.username;
        logger.info(`Starting Bundle command for user ${username}`);

        try {
            const address = args[0];
            const isTeamAnalysis = args.length > 1 && args[1].toLowerCase() === 'team';

            if (!validateSolanaAddress(address)) {
                await bot.sendLongMessage(
                    msg.chat.id,
                    "Invalid Solana address. Please provide a valid Solana address.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }

            logger.info(`Processing bundle analysis for address ${address}${isTeamAnalysis ? ' (team analysis)' : ''}`);
            
            const results = await this.bundleAnalyzer.analyzeBundle(address, 50000, isTeamAnalysis);
            
            let formattedMessage;
            if (this.bundleAnalyzer.isPumpfunCoin(address)) {
                formattedMessage = formatMainMessage(results);
            } else {
                formattedMessage = formatNonPumpfunBundleResponse(results, results.tokenInfo);
            }

            await bot.sendMessage(
                msg.chat.id,
                formattedMessage,
                {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                    message_thread_id: messageThreadId
                }
            );

        } catch (error) {
            logger.error('Error in bundle command:', error);
            throw error; // Laisser le MessageHandler gérer l'erreur
        }
    }
}

module.exports = BundleHandler;
