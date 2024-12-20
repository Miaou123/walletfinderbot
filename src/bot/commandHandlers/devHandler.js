const { formatDevAnalysis } = require('../formatters/devFormatter');
const devAnalyzer = require('../../analysis/devAnalyzer');
const { validateSolanaAddress } = require('./helpers');

class DevCommandHandler {
    constructor(userManager, accessControl) {
        this.userManager = userManager;
        this.accessControl = accessControl;
        this.COMMAND_NAME = 'dev';
    }

    async handleCommand(bot, msg, args) {
        const userId = msg.from.id;
        logger.info(`Starting Dev command for user ${msg.from.username}`);

        try {

            if (!args || args.length === 0) {
                await bot.sendMessage(msg.chat.id, 'Please provide a token address to analyze.');
                return;
            }

            const address = args[0];

            if (!validateSolanaAddress(address)) {
                await bot.sendMessage(
                    msg.chat.id,
                    "Invalid Solana address. Please provide a valid Solana address."
                );
                return;
            }

            const loadingMsg = await bot.sendMessage(msg.chat.id, '🔍 Analyzing developer profile...');
            const analysis = await devAnalyzer.analyzeDevProfile(address);
            
            if (!analysis.success) {
                await bot.editMessageText(
                    'Error analyzing developer profile. Please try again later.',
                    {
                        chat_id: msg.chat.id,
                        message_id: loadingMsg.message_id
                    }
                );
                return;
            }

            const formattedMessages = formatDevAnalysis(analysis);
            await bot.deleteMessage(msg.chat.id, loadingMsg.message_id);

            for (const message of formattedMessages) {
                await bot.sendMessage(msg.chat.id, message, {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true
                });
            }
        } catch (error) {
            logger.error('Error in dev command:', error);
            throw error;
        }
    }
}


module.exports = DevCommandHandler;