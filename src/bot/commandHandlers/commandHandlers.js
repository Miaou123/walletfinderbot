
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
const { SupplyTracker } = require('../../tools/SupplyTracker');
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
        this.adminHandler = new AdminCommandHandler(userManager, accessControl, bot);
        this.broadcastHandler = new BroadcastHandler(userManager, accessControl, bot);
        this.subscriptionHandler = new SubscriptionCommandHandler (accessControl, paymentHandler);
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
    
        this.supplyTracker = new SupplyTracker(bot, accessControl);
        this.trackerHandler = new TrackerHandler(this.supplyTracker);

        this.initializeSupplyTracker().catch(err => {
            logger.error('Failed to initialize SupplyTracker:', err);
        });

        // Créer TrackingActionHandler avec l'instance de SupplyTracker
        this.trackingActionHandler = new TrackingActionHandler(this.supplyTracker);
        
        // Mapping des commandes aux handlers
        this.handlers = {};

        this.callbackHandlers = {
          'check_group': this.groupSubscriptionHandler,
          'sub_extend_group': this.groupSubscriptionHandler,
          'check': this.subscriptionHandler,
          'sub_extend': this.subscriptionHandler,
          'track': this.trackingActionHandler,
          'details': this.teamHandler,
          'sd': this.trackingActionHandler,
          'sc': this.trackingActionHandler,
          'st': this.trackingActionHandler,
          'stop': this.trackingActionHandler
      };

        // Définir toutes les commandes avec leurs handlers et contextes
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

        // Itérer sur chaque commande et lier le handler si défini
        for (const [command, { handler, context }] of Object.entries(commands)) {
            if (typeof handler === 'function') {
                this.handlers[command] = handler.bind(context);
                console.log(`Mapped command "${command}" successfully.`);
            } else {
                console.error(`Failed to map command "${command}": handler is undefined.`);
            }
        }

        bot.on('callback_query', async (query) => {
          try {
              const parts = query.data.split('_');
              
              // Pour gérer correctement les cas comme 'sub_extend_group'
              let baseHandlerKey;
              if (parts.length >= 3 && parts[2] === 'group') {
                  // Pour les actions liées aux groupes
                  baseHandlerKey = `${parts[0]}_${parts[1]}_${parts[2]}`;
              } else {
                  // Pour les autres actions
                  baseHandlerKey = `${parts[0]}_${parts[1]}`;
              }
              
              console.log('Callback Debug:', {
                  data: query.data,
                  parts,
                  baseHandlerKey,
                  availableHandlers: Object.keys(this.callbackHandlers)
              });

              const handler = this.callbackHandlers[baseHandlerKey];
              
              if (handler) {
                  console.log(`Handler found for ${baseHandlerKey}, executing callback`);
                  await handler.handleCallback(bot, query);
              } else {
                  console.log(`No handler found for base key: ${baseHandlerKey}`);
                  throw new Error(`No handler found for callback: ${query.data}`);
              }
          } catch (error) {
              console.error('Error in callback query handler:', error);
              await bot.answerCallbackQuery(query.id, {
                  text: "An error occurred",
                  show_alert: true
              });
          }
        });
        console.log('Command Handlers Mapping:', Object.keys(this.handlers));
    }

    async initializeSupplyTracker() {
        await this.supplyTracker.init();
    }

    getHandlers() {
        return this.handlers;
    }
}

module.exports = CommandHandlers;