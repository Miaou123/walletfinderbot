const logger = require('../../utils/logger');
const { UserService } = require('../../database'); 
const solanaAddressRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

class ReferralHandler {
  constructor(stateManager) {
    this.stateManager = stateManager;
  }

  /**
   * Format SOL amount to USD
   */
  async getUSDValue(solAmount) {
    // TODO: Implement actual SOL/USD conversion
    return (solAmount * 100).toFixed(2); // Example conversion rate: 1 SOL = $100
  }

  /**
   * Format message with user's referral data
   */
  async formatReferralMessage(userData, referralLink) {
    // Formatage des nombres avec 2 décimales
    const formatSOL = (number) => parseFloat(number || 0).toFixed(2);

    const totalRewards = formatSOL(userData.totalRewards);
    const unclaimedRewards = formatSOL(userData.unclaimedRewards);
    const claimedRewards = formatSOL(userData.claimedRewards);
    const referralConversions = userData.referralConversions || 0;

    let message = "💫 <b>Noesis Referral Program - Earn While You Share!</b>\n\n";

    message += "💎 <b>How It Works</b>\n";
    message += "• Share your unique referral link with friends\n";
    message += "• They get 10% OFF their subscription\n";
    message += "• You earn 10% of their subscription fee\n";
    message += "• You can claim you rewards instantly\n";
    message += "• No limit on the number of referrals!\n\n";
    
    message += "📊 <b>Your Statistics</b>\n";
    message += `• Users referred: <code>${referralConversions}</code> (active subscribers)\n`;
    message += `• Total rewards earned: <code>${totalRewards}</code> SOL\n`;
    message += `• Unclaimed rewards: <code>${unclaimedRewards}</code> SOL\n`;
    message += `• Claimed rewards: <code>${claimedRewards}</code> SOL\n\n`;

    if (!userData.referralWallet) {
        message += "Your Referral Link:\nPlease set up your deposit address to view your referral link.\n";
    } else {
        message += `🔗 <b>Your Referral Link:</b>\n<code>${referralLink}</code>\n\n`;
        const fullAddr = userData.referralWallet;
        const displayAddr = fullAddr.slice(0,4) + '...' + fullAddr.slice(-4);
        message += `💰 Rewards Wallet: <code>${fullAddr}</code> (${displayAddr})`; 
    }

    return message;
  }

  /**
   * Main handler for /referral command
   */
  async handleCommand(bot, msg) {
    const chatId = msg.chat.id.toString();
    const username = (msg.from.username || '').toLowerCase();
    
    try {
        let referralDoc = await UserService.getUserByChatId(chatId);

        if (!referralDoc) {
          logger.info(`No user found for chatId: ${chatId}. Creating new user.`);
          referralDoc = await UserService.createOrUpdateUser(chatId, username);
        }

        const referralLink = referralDoc?.referralLink 
          || await UserService.saveReferralLink(chatId, username);

        const message = await this.formatReferralMessage(referralDoc, referralLink);

        // Inline keyboard setup
        const inlineKeyboard = [[
          !referralDoc.referralWallet 
            ? { text: "Set Address", callback_data: "referral:setAddress" }
            : { text: "Change Address", callback_data: "referral:changeAddress" }
        ]];

        await bot.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: inlineKeyboard }
        });

    } catch (err) {
        logger.error("Error in /referral handleCommand:", err);
        await bot.sendMessage(chatId, 
            "An error occurred while processing your referral request. Please try again later."
        );
    }
  }

  /**
   * handleCallback gère les interactions sur les boutons inline ("Set Address", etc.)
   */
  async handleCallback(bot, query) {
    const chatId = query.message.chat.id;
    const username = (query.from.username || '').toLowerCase();
    const data = query.data; // ex: "referral:setAddress"

    try {
      if (data === "referral:setAddress" || data === "referral:changeAddress") {
        // On stocke l'état dans stateManager => l'utilisateur doit saisir l'adresse
        this.stateManager.setUserState(query.from.id, {
          context: 'referral',
          step: 'WAITING_ADDRESS'
        });

        await bot.sendMessage(chatId,
          "Enter your destination wallet for referral rewards.\n\n(Please reply with a valid Solana address.)"
        );
      }

      // si plus tard on veut un bouton "claimRewards", on ferait un else if ...
      
      await bot.answerCallbackQuery(query.id);
    } catch (err) {
      logger.error("Error in referral callback:", err);
      await bot.answerCallbackQuery(query.id, { text: "An error occurred", show_alert: true });
    }
  }

  /**
   * handleAddressInput: on l'appelle depuis messageHandler 
   * quand l'utilisateur est censé saisir son wallet
   */
  async handleAddressInput(bot, msg) {
    const chatId = msg.chat.id.toString();
    const userId = msg.from.id;
    const username = (msg.from.username || '').toLowerCase();
    const text = msg.text.trim();

    if (!solanaAddressRegex.test(text)) {
        await bot.sendMessage(chatId, 
            "That doesn't look like a valid Solana address. Please try again or /cancel."
        );
        return;
    }

    try {
        // Update the wallet using chatId
        await UserService.setReferralWallet(chatId, text);

        // Get the updated user data
        const userData = await UserService.getUserByChatId(chatId);
        const referralLink = userData?.referralLink || 
            await UserService.saveReferralLink(chatId, username);

        // Format the message using the existing method
        const message = await this.formatReferralMessage(userData, referralLink);

        // Remove the state
        this.stateManager.deleteUserState(userId);

        // Send confirmation with updated info
        await bot.sendMessage(chatId, 
            message,
            { 
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[
                        { text: "Change Address", callback_data: "referral:changeAddress" }
                    ]]
                }
            }
        );
    } catch (err) {
        logger.error("Error setting referral wallet for user:", err);
        await bot.sendMessage(chatId, 
            "An error occurred while saving your wallet. Please try again later."
        );
    }
  }
}

module.exports = ReferralHandler;
