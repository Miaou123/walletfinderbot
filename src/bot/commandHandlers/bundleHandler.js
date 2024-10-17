const analyzeBundle = require('../../analysis/bundle');
const formatMainMessage = require('../formatters/bundleFormatter');
const logger = require('../../utils/logger');
const { validateArgs } = require('../commandsManager/commandParser');

class BundleHandler {
  constructor(userManager, accessControl) {
    this.userManager = userManager;
    this.accessControl = accessControl;
  }

  async handleCommand(bot, msg, args) {
    try {
      const validationErrors = validateArgs('bundle', args);
      if (validationErrors.length > 0) {
        await bot.sendLongMessage(msg.chat.id, validationErrors.join('\n\n'));
        return;
      }

      const address = args[0];
      const isTeamAnalysis = args.length > 1 && args[1].toLowerCase() === 'team';

      logger.info(`Starting Bundle command for user ${msg.from.username} with address ${address}${isTeamAnalysis ? ' (team analysis)' : ''}`);
      
      const results = await analyzeBundle(address, 50000, isTeamAnalysis);
      const mainMessage = formatMainMessage(results);
      await bot.sendMessage(msg.chat.id, mainMessage, { parse_mode: 'HTML', disable_web_page_preview: true });
    } catch (error) {
      logger.error('Error in bundle command:', error);
      await bot.sendLongMessage(msg.chat.id, 'An error occurred while analyzing the bundle. Please try again later.');
    }
  }
}

module.exports = BundleHandler;