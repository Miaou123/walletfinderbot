const logger = require('../../utils/logger');
const UserService = require('../../database/services/userService');

class StartHandler {
  constructor() {
    this.COMMAND_NAME = 'start';
  }

  async handleCommand(bot, msg, args) {
    const chatId = String(msg.chat.id);
    const userId = msg.from.id.toString();
    const username = (msg.from.username || '').toLowerCase();

    try {
      // No special handling needed for wallet checker links anymore
      
      // Check if there's a referral link
      let referrerUserId = null;
      if (args.length > 0 && args[0].startsWith('r-')) {
        const referrerUsername = args[0].slice(2).toLowerCase();
        const referrer = await UserService.getUser(referrerUsername);
        if (referrer) {
          referrerUserId = referrer.userId;
        }
      }

      // Create or update user (only once)
      await UserService.createOrUpdateUser(msg);

      // Store referral if exists
      if (referrerUserId) {
        await UserService.storeReferralUsage(msg, referrerUserId);
      }

      const startMessage = `
<b>Welcome to Noesis! 👁️</b>

<b>🔍 Track and analyze Solana tokens and wallets with powerful tools:</b>
- /scan, /bundle, /dexpaid and /walletchecker - Free for everyone
- Advanced features are available with subscription (use /help to see a list of all the advanced features)

Try it now: /scan [token_address] to analyze any token

<b>💫 Subscription Plans:</b>
- Personal: 0.5 SOL/month
- Groups: 2 SOL/month
Use the command  /subscribe or /subscribe_group to access the subscription panel or view your current subscription.

<b>🔗 Earn rewards by referring others!</b>
- Get 10% off your subscription
- Earn 10% commission on referrals
Use the command /referral to access your referral panel.

Need help? Use /help for commands or contact @Rengon0x for support.

<b>Join our community:</b>
- Twitter: @NoesisTracker
- Documentation: https://smp-team.gitbook.io/noesis-bot
      `;

      await bot.sendMessage(chatId, startMessage, { parse_mode: 'HTML' , disable_web_page_preview: true});

    } catch (error) {
      logger.error(`Error in start command for user ${userId}: ${error}`);
      await bot.sendMessage(chatId, 
        "An error occurred while processing your start request. Please try again later."
      );
    }
  }
}

module.exports = StartHandler;