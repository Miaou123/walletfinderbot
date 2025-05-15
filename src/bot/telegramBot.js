// bot/telegramBot.js
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const winston = require('winston');
const config = require('../utils/config');
const CommandHandlers = require('./commandHandlers/commandHandlers');
const ClaimSystem = require('../tools/claimSystem.js');
const ActiveCommandsTracker = require('./commandsManager/activeCommandsTracker');
const { commandConfigs, adminCommandConfigs } = require('./commandsManager/commandConfigs');
const AccessControlDB = require('./accessManager/accessControlDB');
const SolanaPaymentHandler = require('../tools/solanaPaymentHandler.js');
const groupMessageLogger = require('./messageDataManager/groupMessageLogger');
const MessageHandler = require('./messageHandler');
const WalletUpdateManager = require('./walletUpdateManager');
const TokenBalanceChecker = require('../tools/tokenBalanceChecker');
const { getDatabase } = require('../database');

// ====================
// TelegramBotService
// ====================
class TelegramBotService {
    constructor() {
        this.initializeConstants();
        this.setupPaths();
        this.setupLogger();

        // Lance la procédure de démarrage
        this.start().catch(error => {
            this.logger.error('Failed to start bot:', error);
            process.exit(1);
        });
    }

    initializeConstants() {
        this.ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;
        this.MAX_MESSAGE_LENGTH = 4096;
    }

    setupPaths() {
        this.basePath = path.resolve(__dirname, '..');
        this.configPath = path.join(this.basePath, 'config');
        this.dataPath = path.join(this.basePath, 'data');
        // Chemin du fichier users
        this.userFilePath = path.join(this.dataPath, 'all_users.json');
    }

    setupLogger() {
        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.simple()
            ),
            transports: [new winston.transports.Console()]
        });
    }

    async start() {
        try {
            await this.initializeDatabase();
            await this.initializeBot();
            await this.initializeManagers();
            await this.setupMessageHandler();
            this.setupEventListeners();

            this.logger.info('Bot successfully started and ready to handle messages!');
        } catch (error) {
            this.logger.error('Error during startup:', error);
            throw error;
        }
    }

    async initializeDatabase() {
        try {
            this.db = await getDatabase();
            if (!this.db) {
                throw new Error('Failed to initialize database - connection is null');
            }
            this.logger.info('Database connection established successfully');
        } catch (error) {
            this.logger.error('Failed to connect to database:', error);
            throw error;
        }
    }

    async initializeBot() {
        try {
            this.logger.info('Initializing bot...');
            this.bot = new TelegramBot(config.TELEGRAM_TOKEN, { polling: true });
            // Fonction utilitaire pour gérer les longs messages
            this.bot.sendLongMessage = this.sendLongMessage.bind(this);

            const me = await this.bot.getMe();
            this.bot.options.username = me.username;
            this.logger.info(`Bot initialized as @${me.username}`);

            await this.setupBotCommands();
        } catch (error) {
            this.logger.error('Error initializing bot:', error);
            throw error;
        }
    }

    async setupBotCommands() {
        try {
            const botCommands = Object.entries(commandConfigs)
                .filter(([_, cfg]) => !cfg.hidden)
                .map(([command, cfg]) => ({
                    command: command,
                    description: cfg.description
                }));
            await this.bot.setMyCommands(botCommands);
            this.logger.info('Bot commands menu updated successfully');
        } catch (error) {
            this.logger.error('Error setting up bot commands:', error);
            throw error;
        }
    }

    async initializeManagers() {
        if (!this.db) {
            throw new Error('Database not initialized');
        }

        // 1. Access Control
        this.accessControl = new AccessControlDB(this.db, config);
        await this.accessControl.ensureIndexes();
        
        // Log pour vérifier que l'accessControl a bien ses méthodes
        this.logger.debug('AccessControl after initialization:', {
            methods: Object.getOwnPropertyNames(Object.getPrototypeOf(this.accessControl)),
            hasActiveSubscriptionMethod: typeof this.accessControl.hasActiveSubscription === 'function',
            hasActiveGroupSubscriptionMethod: typeof this.accessControl.hasActiveGroupSubscription === 'function'
        });

        // 3. Créer une seule instance de SolanaPaymentHandler
        this.paymentHandler = new SolanaPaymentHandler(config.HELIUS_RPC_URL);
        this.logger.info('Payment handler initialized');

        // 4. Initialiser le ClaimSystem
        this.claimSystem = new ClaimSystem(
            this.paymentHandler.connection, // Réutiliser la même connexion Solana
            config.REWARD_WALLET_PRIVATE_KEY
        );
        this.logger.info('Claim system initialized');

        // 5. Instancier et initialiser les handlers
        this.commandHandlers = new CommandHandlers(
            this.accessControl,
            this.bot,
            this.paymentHandler,
            this.claimSystem
        );

        await this.commandHandlers.initialize();

        // 6. Initialiser le groupMessageLogger si nécessaire
        groupMessageLogger.initialize();

        // 7. Initialize the wallet update manager to update old wallet data
        this.walletUpdateManager = new WalletUpdateManager({
            ageDays: 7,            // Update wallets older than 7 days
            walletsPerMinute: 10,  // Limit to 10 updates per minute to avoid API overload
            logInterval: 60 * 60 * 1000  // Log stats once per hour
        });
        
        // Start the wallet update manager
        await this.walletUpdateManager.start();
        this.logger.info('Wallet update manager started successfully');
        
        // 8. Initialize token balance checker if token verification is enabled
        if (config.TOKEN_ADDRESS) {
            this.tokenBalanceChecker = new TokenBalanceChecker(this.bot);
            this.tokenBalanceChecker.start();
            this.logger.info('Token balance checker started successfully');
        } else {
            this.logger.info('Token verification not configured, skipping token balance checker');
        }
        
        this.logger.info('All managers initialized successfully');
    }

    async setupMessageHandler() {

        await new Promise(resolve => setTimeout(resolve, 100));
        // On crée le MessageHandler en lui passant nos dépendances 
        this.messageHandler = new MessageHandler({
            bot: this.bot,
            commandHandlers: this.commandHandlers,
            accessControl: this.accessControl,
            rateLimiter: this.rateLimiter,
            config,
            logger: this.logger,
            ActiveCommandsTracker,
            commandConfigs,
            adminCommandConfigs,
            paymentHandler: this.paymentHandler,
            stateManager: this.commandHandlers.stateManager
        });
    
        // Initialiser le messageHandler
        await this.messageHandler.initialize();
        this.logger.info('MessageHandler initialized successfully');
    }

    setupEventListeners() {
        // 1) Messages normaux => on dévie vers le messageHandler
        this.bot.on('message', async (msg) => {
            try {
                await this.messageHandler.handleMessage(msg);
            } catch (error) {
                this.logger.error('Error in message handler:', error);
                try {
                    await this.bot.sendMessage(msg.chat.id,
                        'An error occurred while processing your message. Please try again later.'
                    );
                } catch (sendError) {
                    this.logger.error('Error sending error message:', sendError);
                }
            }
        });

        // 3) Polling error
        this.bot.on('polling_error', (error) => {
            this.logger.error('Polling error:', error);
        });

        // 4) Reset des limites quotidiennes
        setInterval(() => this.resetDailyLimits(), this.ONE_DAY_IN_MS);

        // 5) Process termination handling to gracefully stop services
        process.on('SIGINT', this.handleShutdown.bind(this));
        process.on('SIGTERM', this.handleShutdown.bind(this));

        this.logger.info('Event listeners setup completed');
    }

    async resetDailyLimits() {
        try {
            await this.rateLimiter.resetDailyLimits();
            this.logger.info('Daily rate limits have been reset.');
        } catch (error) {
            this.logger.error('Error resetting daily limits:', error);
        }
    }

    /**
     * Méthode utilitaire pour scinder un message trop long en plusieurs.
     * @returns {Object} The last message object sent, or null if no messages were sent
     */
    async sendLongMessage(chatId, message, options = {}) {
        if (!message) {
            this.logger.error('Attempted to send undefined or null message');
            return null;
        }
    
        const messages = this.splitMessage(String(message));
        let lastSentMessage = null;
        
        for (const msg of messages) {
            if (msg.trim().length > 0) {
                try {
                    const sentMessage = await this.bot.sendMessage(chatId, msg, {
                        parse_mode: 'HTML',
                        disable_web_page_preview: true,
                        ...options,
                        message_thread_id: options.message_thread_id
                    });
                    
                    // Store this as the last message sent
                    lastSentMessage = sentMessage;
                    
                } catch (error) {
                    // Log l'erreur si c'est une question de message trop long
                    if (
                        error.response?.statusCode === 400 &&
                        error.response?.body.description.includes('message is too long')
                    ) {
                        // Découpe encore en sous-chunks et log à nouveau
                        const subMessages = this.splitMessage(msg);
                        for (const subMsg of subMessages) {
                            const sentSubMessage = await this.bot.sendMessage(chatId, subMsg, {
                                parse_mode: 'HTML',
                                disable_web_page_preview: true,
                                ...options,
                                message_thread_id: options.message_thread_id
                            });
                            
                            // Update the last message sent
                            lastSentMessage = sentSubMessage;
                        }
                    } else {
                        this.logger.error('Error sending message:', error);
                        throw error;
                    }
                }
            }
        }
        
        // Return the last message we sent
        return lastSentMessage;
    }
    

    /**
     * Scinde un message en morceaux de taille < MAX_MESSAGE_LENGTH
     */
    splitMessage(message) {
        if (typeof message !== 'string') {
            message = String(message);
        }

        const messages = [];
        let currentMessage = '';
        const lines = message.split('\n');

        for (const line of lines) {
            // Si on peut ajouter la ligne sans dépasser la longueur max
            if (currentMessage.length + line.length + 1 <= this.MAX_MESSAGE_LENGTH) {
                currentMessage += line + '\n';
            } else {
                if (currentMessage) messages.push(currentMessage.trim());
                currentMessage = line + '\n';
            }
        }

        if (currentMessage) messages.push(currentMessage.trim());
        return messages.filter(msg => msg.trim().length > 0);
    }

    /**
     * Gracefully handle shutdown, stopping all services
     */
    handleShutdown() {
        this.logger.info('Received shutdown signal, stopping services...');
        
        // Stop the wallet update manager if it exists
        if (this.walletUpdateManager) {
            this.walletUpdateManager.stop();
            this.logger.info('Wallet update manager stopped');
        }
        
        // Stop the token balance checker if it exists
        if (this.tokenBalanceChecker) {
            this.tokenBalanceChecker.stop();
            this.logger.info('Token balance checker stopped');
        }
        
        // Close any other resources
        // ...

        this.logger.info('All services stopped, shutting down');
        
        // Exit with a delay to allow logs to be written
        setTimeout(() => process.exit(0), 1000);
    }
}

// Exportation de l'instance
const botService = new TelegramBotService();
module.exports = { bot: botService.bot };
