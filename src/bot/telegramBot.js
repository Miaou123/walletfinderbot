// telegrambot.js
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const winston = require('winston');
const fs = require('fs');
const config = require('../utils/config');
const commandHandler = require('./commandHandler');
const CommandHandlers = require('./commandHandlers/commandHandlers');
const UserManager = require('./accessManager/userManager');
const ActiveCommandsTracker = require('./commandsManager/activeCommandsTracker');
const { parseCommand, validateArgs, commandConfigs } = require('./commandsManager/commandParser');
const AccessControl = require('./accessManager/accessControl');
const RateLimiter = require('./commandsManager/commandRateLimiter');
const CommandUsageTracker = require('./commandsManager/commandUsageTracker');
const groupMessageLogger = require('./messageDataManager/groupMessageLogger');
const MessageHandler = require('./messageHandler');

class TelegramBotService {
    constructor() {
        this.initializeConstants();
        this.setupPaths();
        this.setupLogger();
        this.initializeManagers();
        this.initializeBot();
        this.setupMessageHandler();
        this.setupEventListeners();
    }

    initializeConstants() {
        this.ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;
        this.MAX_MESSAGE_LENGTH = 4096;
    }

    setupPaths() {
        this.basePath = path.resolve(__dirname, '..');
        this.configPath = path.join(this.basePath, 'config');
        this.userFilePath = path.join(this.basePath, 'data', 'all_users.json');

        if (!fs.existsSync(this.configPath)) {
            fs.mkdirSync(this.configPath, { recursive: true });
        }
    }

    setupLogger() {
        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.simple(),
            transports: [new winston.transports.Console()]
        });
    }

    initializeManagers() {
        this.userManager = new UserManager(this.userFilePath);
        this.accessControl = new AccessControl(path.join(this.configPath, 'access.json'));
        this.rateLimiter = new RateLimiter(path.join(this.configPath, 'rate_limits.json'));
        this.usageTracker = new CommandUsageTracker(path.join(this.configPath, 'command_usage.json'));
        this.bot = new TelegramBot(config.TELEGRAM_TOKEN, { polling: true });
        this.commandHandlers = new CommandHandlers(
            this.userManager, 
            this.accessControl,
            this.bot
        );

        // Set rate limits
        Object.entries(commandConfigs).forEach(([cmd, config]) => {
            if (config.dailyLimit !== Infinity) {
                this.rateLimiter.setLimit(cmd, config.dailyLimit, this.ONE_DAY_IN_MS);
            }
        });
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
            ActiveCommandsTracker
        });
    }

    async initializeBot() {
        this.bot.sendLongMessage = this.sendLongMessage.bind(this);
        await this.checkAndInitializeBot();
        await this.setupBotCommands();
    }

    async checkAndInitializeBot() {
        try {
            this.logger.info('Starting bot initialization...');
            const me = await this.bot.getMe();
            this.bot.options.username = me.username;
            await this.userManager.loadUsers();
            await commandHandler.initializeUserManager();
            this.checkUsers();
            await commandHandler.initializeSupplyTracker(
                this.bot,
                this.accessControl,
                this.userManager
            );
            groupMessageLogger.initialize();
            this.logger.info('Bot initialization completed successfully');
        } catch (error) {
            this.logger.error('Error during bot initialization:', error);
            throw error;
        }
    }

    checkUsers() {
        console.log('Checking users before initializing CommandHandlers:');
        this.userManager.debugUsers();
    }

    async setupBotCommands() {
        const botCommands = Object.entries(commandConfigs).map(([command, config]) => ({
            command: command,
            description: config.description
        }));
        await this.bot.setMyCommands(botCommands);
    }

    setupEventListeners() {
        // Message handler
        this.bot.on('message', async (msg) => {
            try {
                await this.messageHandler.handleMessage(msg);
            } catch (error) {
                this.logger.error('Error in message handler:', error);
            }
        });

        // Callback query handler
        this.bot.on('callback_query', (callbackQuery) => {
            const messageThreadId = callbackQuery.message.message_thread_id;
            commandHandler.handleCallbackQuery(this.bot, callbackQuery, messageThreadId);
        });

        // Error handler
        this.bot.on('polling_error', (error) => {
            this.logger.error('Polling error:', error);
        });

        // Daily limit reset
        setInterval(() => this.resetDailyLimits(), this.ONE_DAY_IN_MS);
    }

    async resetDailyLimits() {
        await this.rateLimiter.resetDailyLimits();
        this.logger.info('Daily rate limits have been reset.');
    }

    async sendLongMessage(chatId, message, options = {}) {
        if (message === undefined || message === null) {
            this.logger.error('Message is undefined or null');
            return;
        }

        const messages = this.splitMessage(message);
        
        for (const msg of messages) {
            if (msg.trim().length > 0) {
                try {
                    await this.bot.sendMessage(chatId, msg, {
                        ...options,
                        parse_mode: 'HTML',
                        disable_web_page_preview: true,
                        message_thread_id: options.message_thread_id
                    });
                } catch (error) {
                    this.logger.error('Error sending message:', error);
                    if (error.response?.statusCode === 400 && error.response?.body.description.includes('message is too long')) {
                        const subMessages = this.splitMessage(msg);
                        for (const subMsg of subMessages) {
                            await this.bot.sendMessage(chatId, subMsg, {
                                ...options,
                                parse_mode: 'HTML',
                                disable_web_page_preview: true,
                                message_thread_id: options.message_thread_id
                            });
                        }
                    } else {
                        throw error;
                    }
                }
            }
        }
    }

    splitMessage(message) {
        if (typeof message !== 'string') {
            this.logger.error('Invalid message type:', typeof message);
            return [String(message)];
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