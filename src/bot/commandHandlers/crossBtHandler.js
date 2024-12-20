const logger = require('../../utils/logger');
const CrossBtAnalyzer = require('../../analysis/crossBtAnalyzer');
const { formatCrossBtResponse } = require('../formatters/crossBtFormatter');
const { validateSolanaAddress } = require('./helpers');

class CrossBtHandler {
    constructor() {
        this.analyzer = new CrossBtAnalyzer();
        this.COMMAND_NAME = 'crossbt';
    }

    async handleCommand(bot, msg, args, messageThreadId) {
        const userId = msg.from.id;
        const username = msg.from.username;
        logger.info(`Starting CrossBt command for user ${username}`);

        try {
            // Vérification du nombre d'arguments
            if (args.length < 2 || args.length > 3) {
                await bot.sendMessage(msg.chat.id, 'Please provide 2 or 3 token addresses.', {
                    message_thread_id: messageThreadId
                });
                return;
            }

            const tokenAddresses = args;

            // Validation de chaque adresse Solana
            for (const address of tokenAddresses) {
                if (!validateSolanaAddress(address)) {
                    await bot.sendLongMessage(
                        msg.chat.id,
                        `Invalid Solana address detected: ${address}\nPlease provide valid Solana address(es).`,
                        { message_thread_id: messageThreadId }
                    );
                    return;
                }
            }

            logger.info(`Processing CrossBt analysis for addresses: ${tokenAddresses.join(', ')}`);

            const analysisResults = await this.analyzer.analyze(tokenAddresses);
            const formattedMessage = formatCrossBtResponse(analysisResults, tokenAddresses);

            await bot.sendLongMessage(msg.chat.id, formattedMessage, {
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                message_thread_id: messageThreadId
            });

        } catch (error) {
            logger.error('Error in CrossBt command:', error);
            throw error;
        }
    }
}

module.exports = CrossBtHandler;
