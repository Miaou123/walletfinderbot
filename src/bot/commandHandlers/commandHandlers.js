const BroadcastHandler = require('./broadcastHandler');
// Importez ici vos autres gestionnaires de commandes
// const SomeOtherHandler = require('./someOtherHandler');

class CommandHandlers {
  constructor(userManager, accessControl) {
    this.broadcastHandler = new BroadcastHandler(userManager, accessControl);
    // Initialisez ici vos autres gestionnaires de commandes
    // this.someOtherHandler = new SomeOtherHandler(userManager, accessControl);
  }

  // Vous pouvez ajouter ici des méthodes utilitaires si nécessaire
}

module.exports = CommandHandlers;