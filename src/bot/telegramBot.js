// bot/telegramBot.js

const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const winston = require('winston');
const fs = require('fs').promises;
const config = require('../utils/config');
const CommandHandlers = require('./commandHandlers/commandHandlers');
const { UserManager } = require('./accessManager/userManager');
const ActiveCommandsTracker = require('./commandsManager/activeCommandsTracker');
const { parseCommand, validateArgs, commandConfigs } = require('./commandsManager/commandParser');
const AccessControlDB = require('./accessManager/accessControlDB');
const RateLimiter = require('./commandsManager/commandRateLimiter');
const CommandUsageTracker = require('./commandsManager/commandUsageTracker');
const groupMessageLogger = require('./messageDataManager/groupMessageLogger');
const MessageHandler = require('./messageHandler');
const { getDatabase } = require('../database/database');

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
            await this.ensureFilesExist();
            await this.initializeBot();
            await this.initializeManagers();    // <— on initialise nos managers et handlers
            this.setupMessageHandler();
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

    async ensureFilesExist() {
        try {
            await fs.mkdir(this.dataPath, { recursive: true });
            await fs.mkdir(this.configPath, { recursive: true });

            const defaultFiles = [
                {
                    path: this.userFilePath,
                    content: '[]'
                },
                {
                    path: path.join(this.configPath, 'rate_limits.json'),
                    content: '{}'
                },
                {
                    path: path.join(this.configPath, 'command_usage.json'),
                    content: '{}'
                }
            ];

            for (const file of defaultFiles) {
                try {
                    await fs.access(file.path);
                } catch {
                    await fs.writeFile(file.path, file.content);
                    this.logger.info(`Created default file: ${file.path}`);
                }
            }
        } catch (error) {
            this.logger.error('Error ensuring files exist:', error);
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
        this.accessControl = new AccessControlDB(this.db);
        await this.accessControl.ensureIndexes();
        this.logger.info('Access control system initialized');

        // 2. UserManager
        this.userManager = new UserManager(this.userFilePath);
        await this.userManager.loadUsers();
        this.logger.info('User manager initialized');

        // 3. Taux/limites + Usage tracking
        this.rateLimiter = new RateLimiter(path.join(this.configPath, 'rate_limits.json'));
        this.usageTracker = new CommandUsageTracker(path.join(this.configPath, 'command_usage.json'));
        this.logger.info('Rate limiter and usage tracker initialized');

        // 4. Instancier les handlers
        //    -> On y passe le userManager, l'accessControl, et le bot 
        this.commandHandlers = new CommandHandlers(
            this.userManager,
            this.accessControl,
            this.bot
        );

        // 5. Initialiser le groupMessageLogger si nécessaire
        groupMessageLogger.initialize();
        this.logger.info('All managers initialized successfully');
    }

    setupMessageHandler() {
        // On crée le MessageHandler en lui passant nos dépendances 
        this.messageHandler = new MessageHandler({
            bot: this.bot,
            commandHandlers: this.commandHandlers,
            // Plus besoin de `commandHandler`, c'est `commandHandlers` qui gère tout
            accessControl: this.accessControl,
            rateLimiter: this.rateLimiter,
            usageTracker: this.usageTracker,
            config,
            logger: this.logger,
            ActiveCommandsTracker,
            commandConfigs
        });
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

        // 2) Plus besoin de this.bot.on('callback_query', ...) ici,
        //    car c'est fait dans le constructor de CommandHandlers

        // 3) Polling error
        this.bot.on('polling_error', (error) => {
            this.logger.error('Polling error:', error);
        });

        // 4) Reset des limites quotidiennes
        setInterval(() => this.resetDailyLimits(), this.ONE_DAY_IN_MS);

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
     */
    async sendLongMessage(chatId, message, options = {}) {
        if (!message) {
            this.logger.error('Attempted to send undefined or null message');
            return;
        }
    
        // Log du message complet avant de le découper
        this.logger.info(`sendLongMessage -> full original message:\n${JSON.stringify(message)}`);
    
        const messages = this.splitMessage(String(message));
        for (const msg of messages) {
            if (msg.trim().length > 0) {
                // Log du chunk juste avant de l'envoyer
                this.logger.info(`sendLongMessage -> sending chunk:\n${JSON.stringify(msg)}`);
    
                try {
                    await this.bot.sendMessage(chatId, msg, {
                        parse_mode: 'HTML',
                        disable_web_page_preview: true,
                        ...options,
                        message_thread_id: options.message_thread_id
                    });
                } catch (error) {
                    // Log l'erreur si c'est une question de message trop long
                    if (
                        error.response?.statusCode === 400 &&
                        error.response?.body.description.includes('message is too long')
                    ) {
                        // Découpe encore en sous-chunks et log à nouveau
                        const subMessages = this.splitMessage(msg);
                        for (const subMsg of subMessages) {
                            this.logger.info(`sendLongMessage -> sending sub-chunk:\n${JSON.stringify(subMsg)}`);
                            await this.bot.sendMessage(chatId, subMsg, {
                                parse_mode: 'HTML',
                                disable_web_page_preview: true,
                                ...options,
                                message_thread_id: options.message_thread_id
                            });
                        }
                    } else {
                        this.logger.error('Error sending message:', error);
                        throw error;
                    }
                }
            }
        }
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
}

// Exportation de l'instance
const botService = new TelegramBotService();
module.exports = { bot: botService.bot };
