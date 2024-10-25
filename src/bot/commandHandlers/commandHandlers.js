const BroadcastHandler = require('./broadcastHandler');
const BundleHandler = require('./bundleHandler');
const CrossBtHandler = require('./crossBtHandler');
const FreshRatioHandler = require('./freshRatioHandler');

class CommandHandlers {
  constructor(userManager, accessControl) {
    this.broadcastHandler = new BroadcastHandler(userManager, accessControl);
    this.bundle = new BundleHandler(userManager, accessControl);
    this.crossbt = new CrossBtHandler(userManager, accessControl);
    this.freshratio = new FreshRatioHandler(userManager, accessControl);
  }

  // Vous pouvez ajouter ici des méthodes utilitaires si nécessaire
}

module.exports = CommandHandlers;