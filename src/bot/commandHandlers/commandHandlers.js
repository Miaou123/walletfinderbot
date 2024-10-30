const BroadcastHandler = require('./broadcastHandler');
const BundleHandler = require('./bundleHandler');
const CrossBtHandler = require('./crossBtHandler');
const FreshRatioHandler = require('./freshRatioHandler');
const AdminCommandHandler = require('./adminCommandHandler');

class CommandHandlers {
    constructor(userManager, accessControl, bot) {
        this.broadcastHandler = new BroadcastHandler(userManager, accessControl);
        this.bundle = new BundleHandler(userManager, accessControl);
        this.crossbt = new CrossBtHandler(userManager, accessControl);
        this.freshratio = new FreshRatioHandler(userManager, accessControl);
        this.adminHandler = new AdminCommandHandler(userManager, accessControl, bot); 
    }

    // Méthodes utilitaires si nécessaire
}

module.exports = CommandHandlers;