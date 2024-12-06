// handlers/DevCommandHandler.js
const logger = require('../../utils/logger');
const { formatDevAnalysis } = require('../formatters/devFormatter');
const devAnalyzer = require('../../analysis/devAnalyzer');

class DevCommandHandler {
    constructor(userManager, accessControl) {
        this.userManager = userManager;
        this.accessControl = accessControl;
    }

    async handleCommand(bot, msg, args) {
        try {
            if (!args || args.length === 0) {
                await bot.sendMessage(msg.chat.id, 'Please provide a token address to analyze.');
                return;
            }

            const address = args[0];
            logger.info(`Starting Dev analysis for user ${msg.from.username} with token ${address}`);

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
            await bot.sendMessage(
                msg.chat.id,
                'An error occurred while analyzing the developer profile. Please try again later.'
            );
        }
    }
}

module.exports = DevCommandHandler;