const { getAvailableSpots } = require('../../utils/accessSpots');
const logger = require('../../utils/logger');

class StartHandler {
  constructor(userManager) {
    this.userManager = userManager;
    this.COMMAND_NAME = 'start';
  }

  async handleCommand(bot, msg, args) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username;

    if (!this.userManager) {
      logger.error('UserManager not initialized');
      return;
    }

    // On ajoute l'utilisateur
    this.userManager.addUser(userId, chatId, username);

    // On récupère les infos de spots
    const spotsInfo = getAvailableSpots();
    if (!spotsInfo) {
      await bot.sendMessage(chatId, "An error occurred while processing your request.");
      return;
    }

    // Destructurer pour accéder directement
    const { availableSpots, maxUsers } = spotsInfo;

    // Construire le message avec les propriétés correctes
    const startMessage = `
Welcome to Noesis! 👁️

For more information on the bot and the current beta phase, please check our <a href="https://smp-team.gitbook.io/noesis-bot">documentation</a> and follow us on <a href="https://x.com/NoesisTracker">twitter</a>.

You can start by using /help for a full list of commands.

📢 Noesis is also available for groups!. 

If you have any questions, want to report a bug or have any new feature suggestions feel free to dm @Rengon0x on telegram or twitter!

⚠️This bot is still in development phase and will probably be subject to many bugs/issues⚠️
    `;

    await bot.sendMessage(chatId, startMessage, { parse_mode: 'HTML' });
  }
}

module.exports = StartHandler;
