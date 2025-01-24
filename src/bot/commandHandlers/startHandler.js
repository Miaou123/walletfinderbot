const logger = require('../../utils/logger');
const UserService = require('../../database/services/userService');

class StartHandler {
 constructor(userManager) {
   this.userManager = userManager;
   this.COMMAND_NAME = 'start';
 }

 async handleCommand(bot, msg, args) {
   const chatId = String(msg.chat.id);
   const userId = msg.from.id;
   const username = msg.from.username;

   if (args.length > 0 && args[0].startsWith('r-')) {
     const referrerUsername = args[0].slice(2).toLowerCase();
     try {
       await UserService.storeReferralUsage(username, referrerUsername);
     } catch (error) {
       logger.error(`Error processing referral: ${error}`);
     }
   }

   try {
     // On ajoute/met à jour l'utilisateur dans la DB
     await UserService.createOrUpdateUser(chatId, username);
   } catch (error) {
     logger.error(`Error creating/updating user: ${error}`);
   }

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
