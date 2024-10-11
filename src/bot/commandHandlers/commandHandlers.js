// commandHandlers.js

const BroadcastHandler = require('./broadcastHandler');
// Importez ici vos autres gestionnaires de commandes
// const SomeOtherHandler = require('./someOtherHandler');

class CommandHandlers {
  constructor(userManager, accessControl) {
    this.broadcastHandler = new BroadcastHandler(userManager, accessControl);
    // Initialisez ici vos autres gestionnaires
    // this.someOtherHandler = new SomeOtherHandler(...);
  }

  // Vous pouvez ajouter ici des méthodes utilitaires si nécessaire
}

module.exports = CommandHandlers;