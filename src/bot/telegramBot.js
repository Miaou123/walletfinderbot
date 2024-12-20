const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const winston = require('winston');
const fs = require('fs').promises;
const config = require('../utils/config');
const commandHandler = require('./commandHandler');
const CommandHandlers = require('./commandHandlers/commandHandlers');
const UserManager = require('./accessManager/userManager');
const ActiveCommandsTracker = require('./commandsManager/activeCommandsTracker');
const { parseCommand, validateArgs, commandConfigs } = require('./commandsManager/commandParser');
const AccessControlDB = require('./accessManager/accessControlDB');
const RateLimiter = require('./commandsManager/commandRateLimiter');
const CommandUsageTracker = require('./commandsManager/commandUsageTracker');
const groupMessageLogger = require('./messageDataManager/groupMessageLogger');
const MessageHandler = require('./messageHandler');
const { getDatabase } = require('../database/database');

class TelegramBotService {
    constructor() {
        this.initializeConstants();
        this.setupPaths();
        this.setupLogger();
        
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
            await this.initializeManagers();
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

    async initializeManagers() {
        try {
            if (!this.db) {
                throw new Error('Database not initialized');
            }

            // Initialiser le système de contrôle d'accès avec MongoDB
            this.accessControl = new AccessControlDB(this.db);
            await this.accessControl.initialize();
            this.logger.info('Access control system initialized');

            // Initialiser le gestionnaire d'utilisateurs
            this.userManager = new UserManager(this.userFilePath);
            await this.userManager.loadUsers();
            this.logger.info('User manager initialized');

            // Initialiser les systèmes de limitation et de suivi
            this.rateLimiter = new RateLimiter(path.join(this.configPath, 'rate_limits.json'));
            this.usageTracker = new CommandUsageTracker(path.join(this.configPath, 'command_usage.json'));
            this.logger.info('Rate limiter and usage tracker initialized');

            // Initialiser les gestionnaires de commandes
            this.commandHandlers = new CommandHandlers(
                this.userManager,
                this.accessControl,
                this.bot
            );

            // Initialiser les composants supplémentaires
            await commandHandler.initializeUserManager();
            await commandHandler.initializeSupplyTracker(
                this.bot,
                this.accessControl,
                this.userManager
            );
            groupMessageLogger.initialize();

            this.logger.info('All managers initialized successfully');
        } catch (error) {
            this.logger.error('Error initializing managers:', error);
            throw error;
        }
    }

    setupMessageHandler() {
        this.messageHandler = new MessageHandler({
            bot: this.bot,
            commandHandlers: this.commandHandlers,
            commandHandler,
            accessControl: this.accessControl,
            rateLimiter: this.rateLimiter,
            usageTracker: this.usageTracker,
            config,
            logger: this.logger,
            ActiveCommandsTracker,
            commandConfigs
        });
    }

    async setupBotCommands() {
        try {
            const botCommands = Object.entries(commandConfigs)
                .filter(([_, config]) => !config.hidden)
                .map(([command, config]) => ({
                    command: command,
                    description: config.description
                }));
            await this.bot.setMyCommands(botCommands);
            this.logger.info('Bot commands menu updated successfully');
        } catch (error) {
            this.logger.error('Error setting up bot commands:', error);
            throw error;
        }
    }

    setupEventListeners() {
        // Message handler
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

        // Callback query handler
        this.bot.on('callback_query', async (callbackQuery) => {
            try {
                const messageThreadId = callbackQuery.message.message_thread_id;
                await commandHandler.handleCallbackQuery(this.bot, callbackQuery, messageThreadId);
            } catch (error) {
                this.logger.error('Error in callback query handler:', error);
            }
        });

        // Error handler
        this.bot.on('polling_error', (error) => {
            this.logger.error('Polling error:', error);
        });

        // Daily limit reset
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

    async sendLongMessage(chatId, message, options = {}) {
        if (!message) {
            this.logger.error('Attempted to send undefined or null message');
            return;
        }

        const messages = this.splitMessage(String(message));
        
        for (const msg of messages) {
            if (msg.trim().length > 0) {
                try {
                    await this.bot.sendMessage(chatId, msg, {
                        parse_mode: 'HTML',
                        disable_web_page_preview: true,
                        ...options,
                        message_thread_id: options.message_thread_id
                    });
                } catch (error) {
                    if (error.response?.statusCode === 400 && 
                        error.response?.body.description.includes('message is too long')) {
                        const subMessages = this.splitMessage(msg);
                        for (const subMsg of subMessages) {
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

    splitMessage(message) {
        if (typeof message !== 'string') {
            message = String(message);
        }

        const messages = [];
        let currentMessage = '';
        const lines = message.split('\n');

        for (const line of lines) {
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

// Create and export bot instance
const botService = new TelegramBotService();
module.exports = { bot: botService.bot };