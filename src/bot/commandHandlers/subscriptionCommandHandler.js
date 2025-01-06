// subscriptionCommandHandler.js

const SolanaPaymentHandler = require('../../solanaPaymentHandler/solanaPaymentHandler');
const logger = require('../../utils/logger');
const { savePaymentAddress, updatePaymentAddressStatus } = require('../../database/database');

class SubscriptionCommandHandler {
  /**
   * 
   * @param {Object} accessControl - Ton objet pour gérer les subscriptions en DB (AccessControlDB)
   * @param {string} heliusUrl - URL Solana RPC
   */
  constructor(accessControl, heliusUrl) {
    this.accessControl = accessControl;
    // On instancie la logique blockchain
    this.paymentHandler = new SolanaPaymentHandler(heliusUrl);
  }

  /**
   * Méthode pour la commande /subscribe
   * 
   * @param {Object} bot 
   * @param {Object} msg 
   * @param {Array} args 
   */
  async handleCommand(bot, msg, args) {
    const chatId = msg.chat.id;
    const username = (msg.from.username || '').toLowerCase().replace(/^@/, '');

    try {
      // Exemple : si l’utilisateur fait "/subscribe 3month", on récupère "3month" comme durée
      const duration = args[0] || '1month'; // fallback
      const session = await this.paymentHandler.createPaymentSession(username, duration);

      // **Nouvelle partie** : Enregistrer immédiatement la session dans payment_addresses
      //   via ta fonction `savePaymentAddress()`.
      await savePaymentAddress({
        sessionId: session.sessionId,
        username: username,
        paymentAddress: session.paymentAddress,
        privateKey: this.paymentHandler.getPrivateKey(session.sessionId), // On va l'expliquer ci-dessous
        amount: session.amount,
        duration: session.duration,
        created: new Date(),
        expires: session.expires,
        status: 'pending'
      });

      // Prépare le message à envoyer à l'utilisateur
      const message =
        `💳 <b>Payment Details</b>\n\n` +
        `Amount: ${session.amount} SOL\n` +
        `Duration: ${session.duration}\n\n` +
        `Please send exactly this amount to:\n<code>${session.paymentAddress}</code>\n\n` +
        `Then click "Check Payment" once done.\n\n` +
        `Session expires: ${session.expires.toLocaleString()}`;

      // Bouton "Check Payment"
      const keyboard = {
        inline_keyboard: [
          [
            {
              text: 'Check Payment',
              callback_data: `check_${session.sessionId}`
            }
          ]
        ]
      };

      await bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
    } catch (error) {
      logger.error('Error in /subscribe handleCommand:', error);
      await bot.sendMessage(chatId,
        'An error occurred while creating your subscription session. Please try again later.'
      );
    }
  }

  /**
   * Méthode pour /confirm (optionnelle, si tu veux un flow explicite)
   */
  async handleConfirm(bot, msg, args) {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, 'handleConfirm not implemented yet.');
  }

  /**
   * Gère les callback_query de type "check_<sessionId>"
   * 
   * @param {Object} bot 
   * @param {Object} query 
   */
  async handleCallback(bot, query) {
    const chatId = query.message.chat.id;
    const callbackData = query.data; // ex: "check_123e4567-..."
    const username = (query.from.username || '').toLowerCase().replace(/^@/, '');
  
    try {
      if (callbackData.startsWith('check_')) {
        const sessionId = callbackData.slice('check_'.length);
  
        // 1. On vérifie le paiement côté Solana
        const result = await this.paymentHandler.checkPayment(sessionId);
        if (result.success) {
          // Paiement détecté
          if (result.alreadyPaid) {
            await bot.sendMessage(chatId, "✅ Payment was already confirmed. Subscription is active!");
          } else {
            // Payment tout juste confirmé
            await bot.sendMessage(chatId, "✅ Payment confirmed! Your subscription is being activated...");
  
            // 1) Mettre à jour le status dans payment_addresses => 'completed'
            await updatePaymentAddressStatus(sessionId, 'completed');
  
            // 2) Appeler accessControl pour créer ou mettre à jour l'abonnement
            const sessionData = this.paymentHandler.getSession(sessionId);
            const userDuration = sessionData.duration; 
            const paymentId = `sol_payment_${Date.now()}`;
  
            await this.accessControl.createSubscription(username, userDuration);
            await this.accessControl.updateSubscriptionPayment(username, paymentId, 'completed');
  
            const subscription = await this.accessControl.getSubscription(username);
  
            // 3) Transférer les fonds en interne (pas de message utilisateur)
            try {
              await this.paymentHandler.transferFunds(sessionId);
            } catch (err) {
              // On loggue l'erreur seulement côté serveur, pas pour l'utilisateur
              logger.error(`Error transferring funds automatically for session ${sessionId}:`, err);
            }
  
            // On informe uniquement l’utilisateur que son abonnement est actif
            await bot.sendMessage(chatId,
              `🎉 Your subscription is now active!\n` +
              `Expires at: ${subscription.expiresAt.toLocaleString()}`
            );
          }
        } else {
          // Le paiement n’est pas (ou pas assez) détecté, OU session expirée, etc.
          if (result.reason === 'Session expired.') {
            await bot.sendMessage(chatId, "❌ The payment session has expired.");
          } else if (result.reason === 'Payment not detected yet') {
            // Cas "pas assez de fonds"
            // => On peut comparer le solde détecté vs. le amount attendu
            const partialBalance = result.partialBalance ?? 0;
            const sessionData = this.paymentHandler.getSession(sessionId);
            const shortfall = (sessionData.amount - partialBalance).toFixed(3); // ex. 0.123
  
            if (partialBalance > 0) {
              // L'utilisateur a envoyé une partie, mais pas assez
              await bot.sendMessage(chatId,
                `🚫 You sent ${partialBalance} SOL, but you need ${sessionData.amount} SOL.\n` +
                `You are short by ${shortfall} SOL. Please send the remaining amount.`
              );
            } else {
              // Aucune transaction
              await bot.sendMessage(chatId,
                "🚫 Payment not detected yet. Please try again in a moment."
              );
            }
          } else {
            // Autres raisons
            await bot.sendMessage(chatId, `⚠️ Error: ${result.reason}`);
          }
        }
  
        await bot.answerCallbackQuery(query.id);
      }
    } catch (error) {
      logger.error('Error in subscription callback:', error);
      await bot.answerCallbackQuery(query.id, { text: "An error occurred", show_alert: true });
    }
  }  
}

module.exports = SubscriptionCommandHandler;
