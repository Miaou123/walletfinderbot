const AdminCommandManager = require('./adminCommands');
const BundleHandler = require('./bundleHandler');
const CrossBtHandler = require('./crossBtHandler');
const FreshRatioHandler = require('./freshRatioHandler');
const FreshHandler = require('./freshHandler');
const DexPaidHandler = require('./dexPaidHandler');
const EntryMapHandler = require('./entryMapHandler');
const DevCommandHandler = require('./devHandler');
const EarlyBuyersHandler = require('./earlyBuyersHandler');
const CrossHandler = require('./crossHandler');
const BestTradersHandler = require('./bestTradersHandler');
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
const WalletSearcherHandler = require('./walletSearcherHandler');
const PreviewHandler = require('./previewHandler');
const TokenVerifyHandler = require('./tokenVerifyHandler');
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

            this.initializeCommandMapping();
            
            // Mapping des callbacks par catégorie
            this.callbackHandlers = {
                'sub': this.subscriptionHandler,
                'group': this.groupSubscriptionHandler,
                'track': this.trackingActionHandler,
                'scan': this.scanHandler,
                'team': this.teamHandler,
                'fresh': this.freshHandler,
                'referral': this.referralHandler,
                'preview': this.previewHandler,
                'walletsearch': this.walletSearcherHandler,
                'besttraders': this.bestTradersHandler,
                'topholders': this.topHoldersHandler,
                'cross': this.crossHandler,
                'earlybuyers': this.earlyBuyersHandler, 
                'tokenverify': this.tokenVerifyHandler
            };

            await this.setupCallbackHandler();
            logger.info('CommandHandlers initialized successfully');
        } catch (error) {
            logger.error('Error initializing CommandHandlers:', error);
            throw error;
        }
    }

    async initializeHandlers() {
        logger.debug('initializeHandlers - AccessControl state before handlers:', {
            hasSubscriptionService: Boolean(this.accessControl.subscriptionService),
            subscriptionServiceMethods: this.accessControl.subscriptionService ? Object.keys(this.accessControl.subscriptionService) : []
        });

        this.adminCommands = new AdminCommandManager(
            this.accessControl,
            this.bot,
        );

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
        this.freshHandler = new FreshHandler(this.stateManager);
        this.dexPaidHandler = new DexPaidHandler();
        this.entryMapHandler = new EntryMapHandler();
        this.devHandler = new DevCommandHandler();
        this.earlyBuyersHandler = new EarlyBuyersHandler();
        this.crossHandler = new CrossHandler(this.stateManager);
        this.bestTradersHandler = new BestTradersHandler();
        this.searchHandler = new SearchHandler();
        this.topHoldersHandler = new TopHoldersHandler();
        this.helpHandler = new HelpHandler(this.bot);
        this.teamHandler = new TeamHandler(this.stateManager);
        this.tokenVerifyHandler = new TokenVerifyHandler(this.accessControl);
        
        // Initialize the wallet searcher handler
        const WalletSearcherHandler = require('./walletSearcherHandler');
        this.walletSearcherHandler = new WalletSearcherHandler(this.accessControl);

        this.supplyTracker = await initializeSupplyTracker(this.bot, this.accessControl);
        this.trackerHandler = new TrackerHandler(this.supplyTracker);

        if (!this.accessControl.subscriptionService?.getUserSubscription) {
            logger.error('getUserSubscription method not found in subscriptionService');
            throw new Error('Invalid subscription service configuration');
        }

        logger.debug('Creating TrackingActionHandler with AccessControl:', {
            hasSubscriptionService: Boolean(this.accessControl.subscriptionService),
            subscriptionServiceMethods: this.accessControl.subscriptionService ? Object.keys(this.accessControl.subscriptionService) : []
        });
        
        this.trackingActionHandler = new TrackingActionHandler(this.supplyTracker, this.accessControl);
    }

    initializeCommandMapping() {
        const commands = {
            // Standard commands
            'start': { handler: this.startHandler.handleCommand, context: this.startHandler },
            'ping': { 
                handler: this.pingHandler.handleCommand.bind(this.pingHandler), 
                context: this.pingHandler 
            },
            'help': { handler: this.helpHandler.handleCommand, context: this.helpHandler },
            'preview': { handler: this.previewHandler.handleCommand, context: this.previewHandler },
            'scan': { handler: this.scanHandler.handleCommand, context: this.scanHandler },
            'subscribe': { handler: this.subscriptionHandler.handleCommand, context: this.subscriptionHandler },
            'subscribe_group': { handler: this.groupSubscriptionHandler.handleCommand, context: this.groupSubscriptionHandler },
            'bundle': { handler: this.bundleHandler.handleCommand, context: this.bundleHandler },
            'walletchecker': { handler: this.walletCheckerHandler.handleCommand, context: this.walletCheckerHandler },
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
            'fresh': { handler: this.freshHandler.handleCommand, context: this.freshHandler },
            'tracker': { handler: this.trackerHandler.handleCommand, context: this.trackerHandler },
            'referral': { handler: this.referralHandler.handleCommand, context: this.referralHandler },
            'walletsearch': { handler: this.walletSearcherHandler.handleCommand, context: this.walletSearcherHandler },
            'verify': { handler: this.tokenVerifyHandler.handleCommand, context: this.tokenVerifyHandler },

            // Admin Commands
            'adduser': { handler: (msg, args) => this.adminCommands.handleCommand('adduser', msg, args) },
            'removeuser': { handler: (msg, args) => this.adminCommands.handleCommand('removeuser', msg, args) },
            'addgroup': { handler: (msg, args) => this.adminCommands.handleCommand('addgroup', msg, args) },
            'removegroup': { handler: (msg, args) => this.adminCommands.handleCommand('removegroup', msg, args) },
            'checksub': { handler: (msg, args) => this.adminCommands.handleCommand('checksub', msg, args) },
            'addsub': { handler: (msg, args) => this.adminCommands.handleCommand('addsub', msg, args) },
            'removesub': { handler: (msg, args) => this.adminCommands.handleCommand('removesub', msg, args) },
            'listsubs': {
                handler: async (msg, args) => {
                    // On passe bien le message complet
                    await this.adminCommands.handleCommand('listsubs', msg, args);
                }
            },
            'listgroups': { handler: (msg, args) => this.adminCommands.handleCommand('listgroups', msg, args) },
            'usagestats': { handler: (msg, args) => this.adminCommands.handleCommand('usagestats', msg, args) },
            'broadcast': { handler: (msg, args) => this.adminCommands.handleCommand('broadcast', msg, args) }
        };

        this.handlers = {};
        for (const [command, { handler, context }] of Object.entries(commands)) {
            if (typeof handler === 'function') {
                this.handlers[command] = handler.bind(context);
                logger.debug(`Mapped command "${command}" successfully.`);
            } else {
                logger.error(`Failed to map command "${command}": handler is undefined.`);
            }
        }
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
                
                const handler = this.callbackHandlers[category];
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
        return this.handlers;
    }
}

// Export the class definition, not a singleton instance
module.exports = CommandHandlers;