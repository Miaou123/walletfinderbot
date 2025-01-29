const logger = require('../../utils/logger');
const UserService = require('../../database/services/userService');

class StartHandler {
 constructor() {
   this.COMMAND_NAME = 'start';
 }

 async handleCommand(bot, msg, args) {
   const chatId = String(msg.chat.id);
   const username = (msg.from.username || '').toLowerCase();

   try {
     // Check if there's a referral link
     let referrerChatId = null;
     if (args.length > 0 && args[0].startsWith('r-')) {
         const referrerUsername = args[0].slice(2).toLowerCase();
         const referrer = await UserService.getUser(referrerUsername);
         if (referrer) {
             referrerChatId = referrer.chatId;
         }
     }

     // Create or update user (only once)
     await UserService.createOrUpdateUser(chatId, username);

     // Store referral if exists
     if (referrerChatId) {
         await UserService.storeReferralUsage(chatId, username, referrerChatId);
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

   } catch (error) {
     logger.error(`Error in start command: ${error}`);
     await bot.sendMessage(chatId, 
       "An error occurred while processing your start request. Please try again later."
     );
   }
 }
}

module.exports = StartHandler;