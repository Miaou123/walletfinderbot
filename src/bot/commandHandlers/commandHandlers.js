const BroadcastHandler = require('./broadcastHandler');
const BundleHandler = require('./bundleHandler');
const CrossBtHandler = require('./crossBtHandler');
const FreshRatioHandler = require('./freshRatioHandler');
const AdminCommandHandler = require('./adminCommandHandler');
const DexPaidHandler = require('./dexPaidHandler');
const EntryMapHandler = require('./entryMapHandler');
const DevCommandHandler = require('./devHandler');
const EarlyBuyersHandler = require('./earlyBuyersHandler'); 
const CrossHandler = require('./crossHandler');
const BestTradersHandler = require('./bestTradersHandler');
const SearchHandler = require('./searchHandler');
const TopHoldersHandler = require('./topHoldersHandler');
//const ScanHandler = require('./scanHandler');

class CommandHandlers {
    constructor(userManager, accessControl, bot) {
        this.broadcastHandler = new BroadcastHandler(userManager, accessControl);
        this.bundle = new BundleHandler(userManager, accessControl);
        this.crossbt = new CrossBtHandler(userManager, accessControl);
        this.freshratio = new FreshRatioHandler(userManager, accessControl);
        this.adminHandler = new AdminCommandHandler(userManager, accessControl, bot);
        this.dexpaid = new DexPaidHandler(userManager, accessControl);
        this.entrymap = new EntryMapHandler(userManager, accessControl);
        this.dev = new DevCommandHandler(userManager, accessControl);
        this.earlybuyers = new EarlyBuyersHandler(userManager, accessControl);
        this.cross = new CrossHandler(userManager, accessControl);
        this.besttraders = new BestTradersHandler(userManager, accessControl);
        this.search = new SearchHandler(userManager, accessControl);
        this.topholders = new TopHoldersHandler(userManager, accessControl);
        //this.scan = new ScanHandler(userManager, accessControl);
    }
}

module.exports = CommandHandlers;