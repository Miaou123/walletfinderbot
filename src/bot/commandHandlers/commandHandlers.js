const BroadcastHandler = require('./broadcastHandler');
const BundleHandler = require('./bundleHandler');
// Importez ici vos autres gestionnaires de commandes
// const SomeOtherHandler = require('./someOtherHandler');

class CommandHandlers {
  constructor(userManager, accessControl) {
    this.broadcastHandler = new BroadcastHandler(userManager, accessControl);
    this.bundle = new BundleHandler(userManager, accessControl);
    // Initialisez ici vos autres gestionnaires de commandes
    // this.someOtherHandler = new SomeOtherHandler(userManager, accessControl);
  }

  // Vous pouvez ajouter ici des méthodes utilitaires si nécessaire
}

module.exports = CommandHandlers;