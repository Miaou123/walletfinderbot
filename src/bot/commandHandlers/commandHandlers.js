
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
const SubscriptionCommandHandler  = require('./subscriptionCommandHandler');
const TrackingActionHandler = require('./trackingActionHandler');
const { SupplyTracker, initializeSupplyTracker } = require('../../tools/SupplyTracker');
const TrackerHandler = require('./trackerHandler');
const HelpHandler = require('./helpHandler');
const StartHandler = require('./startHandler');
const ScanHandler = require('./scanHandler');
const TeamHandler = require('./teamHandler');
const GroupSubscriptionHandler = require('./groupSubhandler');
const stateManager = require('../../utils/stateManager');

const logger = require('../../utils/logger');

class CommandHandlers {
  constructor(userManager, accessControl, bot, paymentHandler) {
      // Initialisation des handlers...
      this.initializeHandlers(userManager, accessControl, bot, paymentHandler)
          .then(() => {
              // Mapping des commandes après l'initialisation des handlers
              this.initializeCommandMapping();
              
              // Mapping des callbacks par catégorie
              this.callbackHandlers = {
                  'sub': this.subscriptionHandler,
                  'group': this.groupSubscriptionHandler,
                  'track': this.trackingActionHandler,
                  'scan': this.scanHandler,
                  'team': this.teamHandler,
              };

              // Setup du handler de callback
              this.setupCallbackHandler(bot);
          })
          .catch(error => {
              logger.error('Error initializing handlers:', error);
              throw error;
          });
  }

  async initializeHandlers(userManager, accessControl, bot, paymentHandler) {
      this.adminHandler = new AdminCommandHandler(userManager, accessControl, bot);
      this.broadcastHandler = new BroadcastHandler(userManager, accessControl, bot);
      this.subscriptionHandler = new SubscriptionCommandHandler(accessControl, paymentHandler);
      this.groupSubscriptionHandler = new GroupSubscriptionHandler(accessControl, paymentHandler);
      this.startHandler = new StartHandler(userManager);
      this.scanHandler = new ScanHandler(stateManager);
      this.bundleHandler = new BundleHandler();
      this.crossBtHandler = new CrossBtHandler();
      this.freshRatioHandler = new FreshRatioHandler();
      this.dexPaidHandler = new DexPaidHandler();
      this.entryMapHandler = new EntryMapHandler();
      this.devHandler = new DevCommandHandler();
      this.earlyBuyersHandler = new EarlyBuyersHandler();
      this.crossHandler = new CrossHandler();
      this.bestTradersHandler = new BestTradersHandler();
      this.searchHandler = new SearchHandler();
      this.topHoldersHandler = new TopHoldersHandler();
      this.helpHandler = new HelpHandler(bot);
      this.teamHandler = new TeamHandler(stateManager);

      this.supplyTracker = await initializeSupplyTracker(bot, accessControl);
 
      this.trackerHandler = new TrackerHandler(this.supplyTracker);
      this.trackingActionHandler = new TrackingActionHandler(this.supplyTracker);

  }

  initializeCommandMapping() {
      const commands = {
          'start': { handler: this.startHandler.handleCommand, context: this.startHandler },
          'scan': { handler: this.scanHandler.handleCommand, context: this.scanHandler },
          'subscribe': { handler: this.subscriptionHandler.handleCommand, context: this.subscriptionHandler },
          'subscribe_group': { handler: this.groupSubscriptionHandler.handleCommand, context: this.groupSubscriptionHandler },
          'adduser': { handler: this.adminHandler.handleAddUser, context: this.adminHandler },
          'removeuser': { handler: this.adminHandler.handleRemoveUser, context: this.adminHandler },
          'addgroup': { handler: this.adminHandler.handleAddGroup, context: this.adminHandler },
          'removegroup': { handler: this.adminHandler.handleRemoveGroup, context: this.adminHandler },
          'checksub': { handler: this.adminHandler.handleCheckSubscription, context: this.adminHandler },
          'addsub': { handler: this.adminHandler.handleAddSubscription, context: this.adminHandler },
          'removesub': { handler: this.adminHandler.handleRemoveSubscription, context: this.adminHandler },
          'listsubs': { handler: this.adminHandler.handleListSubscriptions, context: this.adminHandler },
          'listgroups': { handler: this.adminHandler.handleListGroups, context: this.adminHandler },
          'usagestats': { handler: this.adminHandler.handleUsageStats, context: this.adminHandler },
          'broadcast': { handler: this.broadcastHandler.handleBroadcastCommand, context: this.broadcastHandler },
          'bundle': { handler: this.bundleHandler.handleCommand, context: this.bundleHandler },
          'crossbt': { handler: this.crossBtHandler.handleCommand, context: this.crossBtHandler },
          'freshratio': { handler: this.freshRatioHandler.handleCommand, context: this.freshRatioHandler },
          'dexpaid': { handler: this.dexPaidHandler.handleCommand, context: this.dexPaidHandler },
          'entrymap': { handler: this.entryMapHandler.handleCommand, context: this.entryMapHandler },
          'dev': { handler: this.devHandler.handleCommand, context: this.devHandler },
          'earlybuyers': { handler: this.earlyBuyersHandler.handleCommand, context: this.earlyBuyersHandler },
          'cross': { handler: this.crossHandler.handleCommand, context: this.crossHandler },
          'besttraders': { handler: this.bestTradersHandler.handleCommand, context: this.bestTradersHandler },
          'search': { handler: this.searchHandler.handleCommand, context: this.searchHandler },
          'topholders': { handler: this.topHoldersHandler.handleCommand, context: this.topHoldersHandler },
          'help': { handler: this.helpHandler.handleCommand, context: this.helpHandler },
          'team': { handler: this.teamHandler.handleCommand, context: this.teamHandler },
          'tracker': { handler: this.trackerHandler.handleCommand, context: this.trackerHandler },
      };

      this.handlers = {};
      for (const [command, { handler, context }] of Object.entries(commands)) {
          if (typeof handler === 'function') {
              this.handlers[command] = handler.bind(context);
              console.log(`Mapped command "${command}" successfully.`);
          } else {
              console.error(`Failed to map command "${command}": handler is undefined.`);
          }
      }
  }

  setupCallbackHandler(bot) {
    bot.on('callback_query', async (query) => {
        try {
            const [category, action, ...params] = query.data.split(':');
            
            // Ajouter une validation plus stricte
            if (!category || !action) {
                throw new Error('Invalid callback data format');
            }
 
            // Log plus concis
            logger.debug('Callback received:', { category, action, params });
            
            const handler = this.callbackHandlers[category];
            if (handler) {
                await handler.handleCallback(bot, query);
            } else {
                throw new Error(`No handler found for category: ${category}`);
            }
        } catch (error) {
            logger.error('Callback error:', error);
            await bot.answerCallbackQuery(query.id, {
                text: "An error occurred",
                show_alert: true
            });
        }
    });
 }

  async initializeSupplyTracker() {
      await this.supplyTracker.init();
  }

  getHandlers() {
      return this.handlers;
  }
}

module.exports = CommandHandlers;