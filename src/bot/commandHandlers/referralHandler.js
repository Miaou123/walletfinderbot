// src/bot/commandHandlers/referralHandler.js

const logger = require('../../utils/logger');
const { UserService } = require('../../database'); 
const solanaAddressRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

class ReferralHandler {
  constructor(stateManager) {
    this.stateManager = stateManager; // on récupère l'instance du stateManager
  }

  /**
   * Méthode principale pour /referral
   */
  async handleCommand(bot, msg) {
    const chatId = msg.chat.id;
    const username = (msg.from.username || '').toLowerCase();
    
    try {
      // 1) Récupérer ou créer la doc de referral
      const referralDoc = await UserService.createOrUpdateUser(chatId.toString(), username);

      // 2) Construire le message
      let message = "💰 <b>Invite your friends and earn 10% of revenue share</b>\n\n";
      message += `Total Rewards Paid: ${referralDoc.claimedRewards || 0} SOL\n\n`;

      if (!referralDoc.referralWallet) {
        // Pas d'adresse => “Please set up your deposit address”
        message += `Your Referral Link:\nPlease set up your deposit address to view your referral link.\n\n`;
      } else {
        // Si déjà une wallet => on affiche le lien
        const referralLink = `https://t.me/Noesis_local_bot?start=r-${username}`;
        message += `Your Referral Link:\n${referralLink}\n\n`;
      }

      // Afficher `(Deposit Address: xxx...)` si referralWallet existe
      if (referralDoc.referralWallet) {
        const shortAddr = referralDoc.referralWallet.length > 8
          ? referralDoc.referralWallet.slice(0,4) + '...' + referralDoc.referralWallet.slice(-4)
          : referralDoc.referralWallet;
        message += `(Deposit Address: ${shortAddr})`;
      }

      // Inline keyboard
      const inlineKeyboard = [];
      if (!referralDoc.referralWallet) {
        // S'il n'y a pas d'adresse => "Set Address"
        inlineKeyboard.push([
          { text: "Set Address", callback_data: "referral:setAddress" }
        ]);
      } else {
        // Sinon "Change Address"
        inlineKeyboard.push([
          { text: "Change Address", callback_data: "referral:changeAddress" }
        ]);
      }

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
    const chatId = msg.chat.id;
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
        // Update the wallet
        await UserService.setReferralWallet(username, text);

        // Construct the message
        let message = "💰 <b>Invite your friends and earn 10% of revenue share</b>\n\n";
        message += "Total Rewards Paid: 0 SOL\n\n";
        
        const referralLink = `https://t.me/Noesis_local_bot?start=r-${username}`;
        message += `Your Referral Link:\n${referralLink}\n\n`;
        message += `Registered Wallet:\n${text}\n\n`;

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
