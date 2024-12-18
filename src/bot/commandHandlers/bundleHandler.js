const UnifiedBundleAnalyzer = require('../../analysis/bundle');
const { formatMainMessage, formatNonPumpfunBundleResponse } = require('../formatters/bundleFormatter');
const logger = require('../../utils/logger');
const { validateArgs } = require('../commandsManager/commandParser');
const ActiveCommandsTracker = require('../commandsManager/activeCommandsTracker');

class BundleHandler {
    constructor(userManager, accessControl) {
        this.userManager = userManager;
        this.accessControl = accessControl;
        this.bundleAnalyzer = new UnifiedBundleAnalyzer();
        this.COMMAND_NAME = 'bundle';
    }

    async handleCommand(bot, msg, args) {
        const userId = msg.from.id;
        logger.info(`Starting Bundle command for user ${msg.from.username}`);

        try {
            // Vérifier si l'utilisateur peut exécuter une nouvelle commande
            if (!ActiveCommandsTracker.canAddCommand(userId, this.COMMAND_NAME)) {
                await bot.sendMessage(
                    msg.chat.id,
                    "You already have 3 active commands. Please wait for them to complete."
                );
                return;
            }

            // Ajouter la commande au tracker
            if (!ActiveCommandsTracker.addCommand(userId, this.COMMAND_NAME)) {
                await bot.sendMessage(
                    msg.chat.id,
                    "Unable to add a new command at this time."
                );
                return;
            }

            const address = args[0];
            const isTeamAnalysis = args.length > 1 && args[1].toLowerCase() === 'team';

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
                    disable_web_page_preview: true
                }
            );

        } catch (error) {
            logger.error('Error in bundle command:', error);
            await bot.sendLongMessage(
                msg.chat.id,
                'An error occurred while analyzing the bundle. Please try again later.'
            );
        } finally {
            this._finalizeCommand(userId);
        }
    }

    _finalizeCommand(userId) {
        logger.debug('Bundle command completed');
        ActiveCommandsTracker.removeCommand(userId, this.COMMAND_NAME);
    }
}

module.exports = BundleHandler;