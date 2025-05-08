const AdminCommandManager = require('./adminCommands');
const BundleHandler = require('./bundleHandler');
const CrossBtHandler = require('./crossBtHandler');
const FreshRatioHandler = require('./freshRatioHandler');
// const FreshHandler = require('./freshHandler'); // Using optimized version instead
const DexPaidHandler = require('./dexPaidHandler');
const EntryMapHandler = require('./entryMapHandler');
const DevCommandHandler = require('./devHandler');
const EarlyBuyersHandler = require('./earlyBuyersHandler');
// const CrossHandler = require('./crossHandler'); // Using optimized version instead
// const BestTradersHandler = require('./bestTradersHandler'); // Using optimized version instead
const SearchHandler = require('./searchHandler');
const TopHoldersHandler = require('./topHoldersHandler');
const SubscriptionCommandHandler = require('./subscriptionHandler');
const TrackingActionHandler = require('./trackingActionHandler');
const { SupplyTracker, initializeSupplyTracker } = require('../../tools/SupplyTracker');
const TrackerHandler = require('./trackerHandler');
const HelpHandler = require('./helpHandler');
const StartHandler = require('./startHandler');
const PingHandler = require('./pingHandler');
const ScanHandler = require('./scanHandler');
const TeamHandler = require('./teamHandler');
const GroupSubscriptionHandler = require('./groupSubscriptionHandler');
const ReferralHandler = require('./referralHandler');
const WalletCheckerHandler = require('./walletCheckerHandler');
const PreviewHandler = require('./previewHandler');
const commandRegistry = require('../commandsManager/commandRegistry');
const stateManager = require('../../utils/stateManager');
const logger = require('../../utils/logger');

class CommandHandlers {
    constructor(accessControl, bot, paymentHandler, claimSystem) {
        if (!accessControl || !bot || !paymentHandler) {
            throw new Error('Required dependencies missing');
        }

        this.accessControl = accessControl;
        this.bot = bot;
        this.paymentHandler = paymentHandler;
        this.stateManager = stateManager;
        this.claimSystem = claimSystem;
    }

    async initialize() {
        try {
            logger.debug('CommandHandlers initialize - AccessControl state:', {
                hasSubscriptionService: Boolean(this.accessControl.subscriptionService),
                subscriptionServiceMethods: this.accessControl.subscriptionService ? Object.keys(this.accessControl.subscriptionService) : [],
                accessControlMethods: Object.keys(this.accessControl)
            });

            await this.initializeHandlers();
            this.registerCommands();
            await this.setupCallbackHandler();
            
            logger.info('CommandHandlers initialized successfully');
        } catch (error) {
            logger.error('Error initializing CommandHandlers:', error);
            throw error;
        }
    }

    async initializeHandlers() {
        this.adminCommands = new AdminCommandManager(this.accessControl, this.bot);

        // Initialize all command handlers
        this.subscriptionHandler = new SubscriptionCommandHandler(this.accessControl, this.paymentHandler);
        this.groupSubscriptionHandler = new GroupSubscriptionHandler(this.accessControl, this.paymentHandler);
        this.startHandler = new StartHandler();
        this.pingHandler = new PingHandler(this.bot);
        this.previewHandler = new PreviewHandler();
        this.scanHandler = new ScanHandler(this.stateManager);
        this.referralHandler = new ReferralHandler(this.stateManager, this.claimSystem);
        this.bundleHandler = new BundleHandler();
        this.walletCheckerHandler = new WalletCheckerHandler();
        this.crossBtHandler = new CrossBtHandler();
        this.freshRatioHandler = new FreshRatioHandler();
        // this.freshHandler = new FreshHandler(this.stateManager); // Replaced with optimized version
        this.dexPaidHandler = new DexPaidHandler();
        this.entryMapHandler = new EntryMapHandler();
        this.devHandler = new DevCommandHandler();
        this.earlyBuyersHandler = new EarlyBuyersHandler();
        // Old handlers that have been replaced with optimized versions are commented out
        // this.crossHandler = new CrossHandler();
        // this.bestTradersHandler = new BestTradersHandler();
        this.searchHandler = new SearchHandler();
        this.topHoldersHandler = new TopHoldersHandler();
        this.helpHandler = new HelpHandler(this.bot);
        this.teamHandler = new TeamHandler(this.stateManager);

        this.supplyTracker = await initializeSupplyTracker(this.bot, this.accessControl);
        this.trackerHandler = new TrackerHandler(this.supplyTracker);

        if (!this.accessControl.subscriptionService?.getUserSubscription) {
            logger.error('getUserSubscription method not found in subscriptionService');
            throw new Error('Invalid subscription service configuration');
        }
        
        this.trackingActionHandler = new TrackingActionHandler(this.supplyTracker, this.accessControl);
    }

    registerCommands() {
        // Register regular commands
        const regularCommands = [
            { name: 'start', handler: this.startHandler },
            { name: 'ping', handler: this.pingHandler },
            { name: 'help', handler: this.helpHandler },
            { name: 'preview', handler: this.previewHandler },
            { name: 'scan', handler: this.scanHandler },
            { name: 'subscribe', handler: this.subscriptionHandler },
            { name: 'subscribe_group', handler: this.groupSubscriptionHandler },
            { name: 'bundle', handler: this.bundleHandler },
            { name: 'walletchecker', handler: this.walletCheckerHandler },
            { name: 'crossbt', handler: this.crossBtHandler },
            { name: 'freshratio', handler: this.freshRatioHandler },
            { name: 'dexpaid', handler: this.dexPaidHandler },
            { name: 'entrymap', handler: this.entryMapHandler },
            { name: 'dev', handler: this.devHandler },
            { name: 'earlybuyers', handler: this.earlyBuyersHandler },
            // 'cross' and 'besttraders' are now handled by optimized versions
            // registered directly in the commandRegistry
            { name: 'search', handler: this.searchHandler },
            { name: 'topholders', handler: this.topHoldersHandler },
            { name: 'team', handler: this.teamHandler },
            // 'fresh' is now handled by the optimized version
            // registered directly in the commandRegistry
            { name: 'tracker', handler: this.trackerHandler },
            { name: 'referral', handler: this.referralHandler }
        ];

        // Register all regular commands
        regularCommands.forEach(cmd => {
            const handler = cmd.handler;
            if (handler && typeof handler.handleCommand === 'function') {
                commandRegistry.registerCommand(cmd.name, handler.handleCommand, handler);
            } else {
                logger.error(`Invalid handler for command ${cmd.name}`);
            }
        });

        // Register admin commands
        const adminCommandNames = [
            'adduser', 'removeuser', 'addgroup', 'removegroup', 
            'checksub', 'addsub', 'removesub', 'listsubs', 
            'listgroups', 'usagestats', 'broadcast',
            'addgroupsub', 'removegroupsub', 'listgroupsubs', 'getuser'
        ];

        adminCommandNames.forEach(cmdName => {
            const adminHandler = (bot, msg, args, messageThreadId) => {
                return this.adminCommands.handleCommand(cmdName, msg, args);
            };
            commandRegistry.registerCommand(cmdName, adminHandler, this, true);
        });

        // Register callback handlers
        const callbackHandlers = {
            'sub': this.subscriptionHandler,
            'group': this.groupSubscriptionHandler,
            'track': this.trackingActionHandler,
            'scan': this.scanHandler,
            'team': this.teamHandler,
            // 'fresh' callback is now handled by optimized version registered in commandRegistry
            'referral': this.referralHandler,
            'preview': this.previewHandler,
        };

        Object.entries(callbackHandlers).forEach(([category, handler]) => {
            commandRegistry.registerCallbackHandler(category, handler);
        });
    }

    async setupCallbackHandler() {
        if (!this.bot || typeof this.bot.on !== 'function') {
            throw new Error('Bot instance is not properly initialized');
        }

        this.bot.on('callback_query', async (query) => {
            try {
                const [category, action, ...params] = query.data.split(':');
                
                if (!category || !action) {
                    throw new Error('Invalid callback data format');
                }

                logger.debug('Callback received:', { category, action, params });
                
                const handler = commandRegistry.getCallbackHandler(category);
                if (handler) {
                    await handler.handleCallback(this.bot, query);
                } else {
                    throw new Error(`No handler found for category: ${category}`);
                }
            } catch (error) {
                logger.error('Callback error:', error);
                await this.bot.answerCallbackQuery(query.id, {
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
        const handlers = {};
        
        // Convert registry to the format expected by existing code
        commandRegistry.getAllCommands().forEach(cmd => {
            const handler = commandRegistry.getCommandHandler(cmd.name);
            if (handler) {
                handlers[cmd.name] = handler.handler;
            }
        });
        
        return handlers;
    }
}

module.exports = CommandHandlers;