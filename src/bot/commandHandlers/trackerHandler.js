// bot/commandHandlers/trackerHandler.js

const logger = require('../../utils/logger');

class TrackerHandler {
  /**
   * @param {Object} supplyTracker - Instance de votre SupplyTracker (pour lire/stopper les trackings).
   */
  constructor(supplyTracker) {
    this.COMMAND_NAME = 'tracker';
    this.supplyTracker = supplyTracker;
  }

  /**
   * Méthode appelée lorsque l'utilisateur tape `/tracker`.
   */
  async handleCommand(bot, msg, args, messageThreadId) {
    logger.info(`Starting Tracker command for user ${msg.from.username}`);
    
    const chatId = msg.chat.id;
    const username = msg.from.username;

    // Récupère la liste des trackings actifs pour cet utilisateur
    const trackedSupplies = this.supplyTracker.getTrackedSuppliesByUser(username);
    logger.debug("Tracked supplies:", trackedSupplies);

    // Si aucun tracking n'existe, on avertit l'utilisateur
    if (trackedSupplies.length === 0) {
      await bot.sendMessage(
        chatId,
        "No active tracking. Use /team or /scan to start tracking.",
        { message_thread_id: messageThreadId }
      );
      return;
    }

    // Construit le message HTML et le clavier d'inline buttons
    const message = this.formatTrackerMessage(trackedSupplies);
    const inlineKeyboard = this.buildTrackerKeyboard(trackedSupplies);

    // Envoie le message final
    await bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: inlineKeyboard },
      message_thread_id: messageThreadId
    });
  }

  /**
   * Construit le message global listant chaque tracking.
   */
  formatTrackerMessage(supplies) {
    let message = "<b>Your currently tracked supplies:</b>\n\n";
    supplies.forEach((supply, index) => {
      message += this.formatSupplyEntry(index + 1, supply);
    });
    return message;
  }

  /**
   * Formate un élément (une ligne) pour un tracking donné.
   */
  formatSupplyEntry(index, supply) {
    let {
      ticker,
      tokenAddress,
      trackType,
      currentSupplyPercentage,
      significantChangeThreshold
    } = supply;

    // Convertit en float s'il existe
    currentSupplyPercentage = currentSupplyPercentage ? parseFloat(currentSupplyPercentage) : null;
    significantChangeThreshold = significantChangeThreshold ? parseFloat(significantChangeThreshold) : 'N/A';

    // Choisit un emoji selon le type de tracking
    const typeEmoji = trackType === 'topHolders' ? '🥇' : '👥';

    // Choisit un emoji en fonction du pourcentage
    let supplyEmoji = '☠️'; // par défaut
    if (currentSupplyPercentage !== null) {
      if (currentSupplyPercentage <= 10) supplyEmoji = '🟢';
      else if (currentSupplyPercentage <= 20) supplyEmoji = '🟡';
      else if (currentSupplyPercentage <= 40) supplyEmoji = '🟠';
      else if (currentSupplyPercentage <= 50) supplyEmoji = '🔴';
    }

    // Format final
    const formattedSupply = currentSupplyPercentage !== null ? currentSupplyPercentage.toFixed(2) : 'N/A';

    let entry = `${index}. <b>${ticker}</b> <a href="https://dexscreener.com/solana/${tokenAddress}">📈</a>\n`;
    entry += `   Tracking type: ${trackType} ${typeEmoji}\n`;
    entry += `   Supply: ${formattedSupply}% ${supplyEmoji}\n`;
    entry += `   Threshold: ${significantChangeThreshold}%\n\n`;

    return entry;
  }

  /**
   * Construit le tableau de boutons "Stop tracking X".
   */
  buildTrackerKeyboard(trackedSupplies) {
    const inlineKeyboard = [];
    trackedSupplies.forEach((supply) => {
      const { ticker, tokenAddress, trackType } = supply;

      inlineKeyboard.push([
        {
          text: `Stop tracking ${ticker}`,
          callback_data: `stop_${tokenAddress}_${trackType}` // géré dans votre TrackingActionHandler ou similaire
        }
      ]);
    });
    return inlineKeyboard;
  }
}

module.exports = TrackerHandler;
