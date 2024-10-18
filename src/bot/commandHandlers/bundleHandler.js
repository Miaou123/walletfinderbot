const UnifiedBundleAnalyzer = require('../../analysis/bundle');
const { formatMainMessage, formatNonPumpfunBundleResponse } = require('../formatters/bundleFormatter');
const logger = require('../../utils/logger');
const { validateArgs } = require('../commandsManager/commandParser');

class BundleHandler {
  constructor(userManager, accessControl) {
    this.userManager = userManager;
    this.accessControl = accessControl;
    this.bundleAnalyzer = new UnifiedBundleAnalyzer();
  }

  async handleCommand(bot, msg, args) {
        try {
            const address = args[0];
            const isTeamAnalysis = args.length > 1 && args[1].toLowerCase() === 'team';

            logger.info(`Starting Bundle command for user ${msg.from.username} with address ${address}${isTeamAnalysis ? ' (team analysis)' : ''}`);
            
            const results = await this.bundleAnalyzer.analyzeBundle(address, 50000, isTeamAnalysis);
            
            let formattedMessage;
            if (this.bundleAnalyzer.isPumpfunCoin(address)) {
                formattedMessage = formatMainMessage(results);
            } else {
                // Pour les non-Pumpfun coins, les informations du token sont déjà incluses dans results
                formattedMessage = formatNonPumpfunBundleResponse(results, results.tokenInfo);
            }

            await bot.sendMessage(msg.chat.id, formattedMessage, { parse_mode: 'HTML', disable_web_page_preview: true });
        } catch (error) {
            logger.error('Error in bundle command:', error);
            await bot.sendLongMessage(msg.chat.id, 'An error occurred while analyzing the bundle. Please try again later.');
        }
    }
}

module.exports = BundleHandler;