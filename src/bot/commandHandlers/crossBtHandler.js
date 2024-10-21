const logger = require('../../utils/logger');
const CrossBtAnalyzer = require('../../analysis/crossBtAnalyzer');
const { formatCrossBtResponse } = require('../formatters/crossBtFormatter');

class CrossBtHandler {
    constructor(userManager, accessControl) {
        this.userManager = userManager;
        this.accessControl = accessControl;
        this.analyzer = new CrossBtAnalyzer();
    }

    async handleCommand(bot, msg, args, messageThreadId) {
        try {
            if (args.length < 2 || args.length > 3) {
                await bot.sendMessage(msg.chat.id, 'Please provide 2 or 3 token addresses.', {
                    message_thread_id: messageThreadId
                });
                return;
            }

            const tokenAddresses = args;
            logger.info(`Starting CrossBt command for user ${msg.from.username} with addresses: ${tokenAddresses.join(', ')}`);

            const analysisResults = await this.analyzer.analyze(tokenAddresses);
            logger.debug(`Analysis results received: ${JSON.stringify(analysisResults)}`);
            
            const formattedMessage = formatCrossBtResponse(analysisResults, tokenAddresses);
            logger.debug(`Formatted message: ${formattedMessage}`);

            await bot.sendLongMessage(msg.chat.id, formattedMessage, {
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                message_thread_id: messageThreadId
            });
        } catch (error) {
            logger.error('Error in crossBt command:', error);
            await bot.sendMessage(msg.chat.id, 'An error occurred while analyzing the top traders. Please try again later.', {
                message_thread_id: messageThreadId
            });
        }
    }
}

module.exports = CrossBtHandler;