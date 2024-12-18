const CrossBtAnalyzer = require('../../analysis/crossBtAnalyzer');
const { formatCrossBtResponse } = require('../formatters/crossBtFormatter');

class CrossBtHandler {
    constructor(userManager, accessControl) {
        this.userManager = userManager;
        this.accessControl = accessControl;
        this.analyzer = new CrossBtAnalyzer();
        this.COMMAND_NAME = 'crossbt';
    }

    async handleCommand(bot, msg, args, messageThreadId) {
        const userId = msg.from.id;
        logger.info(`Starting CrossBt command for user ${msg.from.username}`);

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

            if (args.length < 2 || args.length > 3) {
                await bot.sendMessage(msg.chat.id, 'Please provide 2 or 3 token addresses.', {
                    message_thread_id: messageThreadId
                });
                return;
            }

            const tokenAddresses = args;
            logger.info(`Processing CrossBt analysis for addresses: ${tokenAddresses.join(', ')}`);

            const analysisResults = await this.analyzer.analyze(tokenAddresses);
            const formattedMessage = formatCrossBtResponse(analysisResults, tokenAddresses);

            await bot.sendLongMessage(msg.chat.id, formattedMessage, {
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                message_thread_id: messageThreadId
            });

        } catch (error) {
            logger.error('Error in crossBt command:', error);
            await bot.sendMessage(msg.chat.id,
                'An error occurred while analyzing the top traders. Please try again later.',
                { message_thread_id: messageThreadId }
            );
        } finally {
            this._finalizeCommand(userId);
        }
    }

    _finalizeCommand(userId) {
        logger.debug('CrossBt command completed');
        ActiveCommandsTracker.removeCommand(userId, this.COMMAND_NAME);
    }
}

module.exports = CrossBtHandler;