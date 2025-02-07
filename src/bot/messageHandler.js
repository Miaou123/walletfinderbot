const CommandParser = require('./commandsManager/commandParser');  // Nouvelle classe
const groupMessageLogger = require('./messageDataManager/groupMessageLogger');
const UserService = require('../database/services/userService'); 

class MessageHandler {
    constructor(dependencies) {
        this.bot = dependencies.bot;
        this.commandHandlersInstance = dependencies.commandHandlers;
        this.commandHandlers = {}; 
        this.accessControl = dependencies.accessControl;
        this.rateLimiter = dependencies.rateLimiter;
        this.config = dependencies.config;
        this.logger = dependencies.logger;
        this.ActiveCommandsTracker = dependencies.ActiveCommandsTracker;
        this.MAX_MESSAGE_AGE = 600;
        this.commandConfigs = dependencies.commandConfigs;
        this.adminCommandConfigs = dependencies.adminCommandConfigs;
        this.commandParser = null;
        this.stateManager = dependencies.stateManager;
    }

    async initialize() {
        try {
            const botInfo = await this.bot.getMe();
            this.botUsername = botInfo.username;
            this.commandParser = new CommandParser(this.botUsername);
            
            // Récupérer les handlers après leur initialisation
            this.commandHandlers = this.commandHandlersInstance.getHandlers();
            
            this.logger.info(`Bot initialized with username: ${this.botUsername}`);
        } catch (error) {
            this.logger.error('Failed to initialize MessageHandler:', error);
            throw error;
        }
    }
    
    // Getter pour les commandes limitées (requiresAuth: true)
    get limitedCommands() {
        return Object.entries(this.commandConfigs)
            .filter(([_, config]) => config.requiresAuth)
            .map(([command, _]) => command);
    }
    
    // Getter pour les commandes de base (requiresAuth: false)
    get basicCommands() {
        return Object.entries(this.commandConfigs)
            .filter(([_, config]) => !config.requiresAuth)
            .map(([command, _]) => command);
    }

    async handleMessage(msg) {
        if (!this.commandParser) {
            this.logger.error('CommandParser not initialized. Call initialize() first');
            return;
        }
    
        if (!msg.text || !msg.from.username) {
            if (!msg.from.username) {
                await this.bot.sendMessage(msg.chat.id, 
                    "Please set a username in your Telegram settings to use this bot."
                );
            }
            return;
        }
    
        const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
        const messageThreadId = msg.message_thread_id;
        const username = msg.from.username;
        const userId = msg.from.id.toString();
        const chatId = msg.chat.id.toString();
    
        // Vérification de l'ancienneté du message
        const currentTimestamp = Math.floor(Date.now() / 1000);
        const messageAge = currentTimestamp - msg.date;
        
        if (messageAge > this.MAX_MESSAGE_AGE) {
            this.logger.info(`Ignored old message from user ${username} (ID: ${userId}): ${msg.text}`);
            return;
        }

        // Vérification de l'enregistrement de l'utilisateur pour les messages privés
        if (!isGroup && msg.text.startsWith('/')) {
            const { command } = this.commandParser.parseCommand(msg.text);
            // On permet /start et /help sans enregistrement
            if (command !== 'start' && command !== 'help') {
                const isRegistered = await UserService.isUserRegistered(userId);
                if (!isRegistered) {
                    this.logger.debug(`Unregistered user ${username} (${userId}) attempted to use command: ${command}`);
                    await this.bot.sendMessage(chatId,
                        "⚠️ Please /start the bot before using any commands.",
                        { message_thread_id: messageThreadId }
                    );
                    return;
                }
            }
        }
    
        // Vérification des commandes
        if (msg.text.startsWith('/')) {
            const { command, isAdmin } = this.commandParser.parseCommand(msg.text);

            if (!command) {
                if (!isGroup) {
                    await this.bot.sendMessage(chatId, "Unknown command. Use /help to see available commands.");
                }
                return;
            }

            // Vérification des commandes admin
            if (isAdmin) {
                const isAdminUser = await this.accessControl.isAdmin(userId);
                if (!isAdminUser) {
                    this.logger.warn(`Non-admin user ${username} (ID: ${userId}) tried to use admin command: ${command}`);
                    return;
                }
                await this.handleCommand(msg, isGroup, messageThreadId);
                return;
            }

            // Vérifier si la commande nécessite une authentification
            const commandConfig = this.commandConfigs[command];
            const requiresAuth = commandConfig?.requiresAuth ?? false;

            if (requiresAuth) {
                if (isGroup) {
                    // Exception pour la commande subscribe_group
                    if (command !== 'subscribe_group') {
                        const hasActiveGroupSub = await this.accessControl.hasActiveGroupSubscription(chatId);
                        if (!hasActiveGroupSub) {
                            await this.bot.sendMessage(chatId,
                                "🔒 This command requires an active group subscription\n\n" +
                                "• Use /subscribe_group to view our group subscription plans\n" +
                                "• Try /preview to test our features before subscribing\n\n" +
                                "Need help? Contact @Rengon0x for support",
                                { message_thread_id: messageThreadId }
                            );
                            return;
                        }
                    }
                } else {
                    // Vérification des utilisateurs individuels
                    const hasActiveUserSub = await this.accessControl.hasActiveSubscription(userId);
                    if (!hasActiveUserSub && command !== 'subscribe') {
                        await this.bot.sendMessage(chatId,
                            "🔒 This command requires an active subscription\n\n" +
                            "• Use /subscribe to view our subscription plans\n" +
                            "• Try /preview to test our features before subscribing\n\n" +
                            "Need help? Contact @Rengon0x for support"
                        );
                        return;
                    }
                }
            }

            await this.handleCommand(msg, isGroup, messageThreadId);
        } else {
            await this.handleNonCommand(msg, messageThreadId);
        }
    }
    
    async handleCommand(msg, isGroup, messageThreadId) {
        const { command, args, isAdmin } = this.commandParser.parseCommand(msg.text);
        const userId = msg.from.id.toString();
        const chatId = msg.chat.id.toString();
    
        if (isGroup && command === 'subscribe') {
            await this.bot.sendMessage(chatId,
                '❌ You cannot use /subscribe in a group chat. Please use /subscribe_group instead.',
                { message_thread_id: messageThreadId }
            );
            return;
        }
    
        try {
            // Gestion des commandes admin
            if (isAdmin) {
                await this.handleAdminCommand(command, msg, args, messageThreadId);
                return;
            }

            const commandConfig = this.commandConfigs[command];
            if (commandConfig && args.length === 0 && command !== 'help' && command !== 'start' && 
                command !== 'subscribe' && command !== 'subscribe_group' && command !== 'ping' && 
                command !== 'cancel' && command !== 'tracker' && command !== 'access' && 
                command !== 'referral' && command !== 'preview') {
                // Afficher l'aide pour cette commande
                this.logger.debug(`Showing help for command ${command} due to no arguments`);
                if (typeof this.commandHandlers['help'] === 'function') {
                    await this.commandHandlers['help'](this.bot, msg, [command], messageThreadId);
                    return;
                }
            }
    
            // Vérification anti-spam
            if (!this.ActiveCommandsTracker.canAddCommand(userId, command)) {
                if (!isGroup) {
                    await this.bot.sendMessage(chatId,
                        "You already have 3 active commands. Please wait for them to complete.",
                        { message_thread_id: messageThreadId }
                    );
                }
                return;
            }
    
            if (!this.ActiveCommandsTracker.addCommand(userId, command)) {
                if (!isGroup) {
                    await this.bot.sendMessage(chatId,
                        "Unable to add a new command at this time.",
                        { message_thread_id: messageThreadId }
                    );
                }
                return;
            }
    
            try {
                const handlerName = command.toLowerCase();
                if (typeof this.commandHandlers[handlerName] === 'function') {
                    await this.commandHandlers[handlerName](this.bot, msg, args, messageThreadId);
                } else {
                    throw new Error(`No handler found for command: ${command}`);
                }                
            } finally {
                this.ActiveCommandsTracker.removeCommand(userId, command);
            }
    
        } catch (error) {
            this.logger.error(`Error in command ${command}:`, error);
            if (!isGroup) {
                await this.bot.sendMessage(chatId,
                    "An error occurred while processing your command. Please try again later.",
                    { message_thread_id: messageThreadId }
                );
            }
            this.ActiveCommandsTracker.removeCommand(userId, command);
        }
    }

    async handleAdminCommand(command, msg, args, messageThreadId) {
        try {
            // On vérifie que msg contient toutes les propriétés nécessaires
            if (!msg?.chat?.id || !msg?.from?.id) {
                this.logger.error('Invalid message format in handleAdminCommand');
                return;
            }
    
            // On s'assure que c'est bien un admin
            const userId = msg.from.id;
            const chatId = String(msg.chat.id);
            
            if (!await this.accessControl.isAdmin(userId)) {
                this.logger.warn(`Non-admin user ${msg.from.username} tried to use admin command: ${command}`);
                await this.bot.sendMessage(chatId, "You are not authorized to use this command.");
                return;
            }
    
            // On utilise notre nouveau AdminCommandManager à travers commandHandlersInstance
            if (this.commandHandlersInstance.adminCommands) {
                await this.commandHandlersInstance.adminCommands.handleCommand(command, msg, args);
            } else {
                throw new Error('AdminCommandManager not initialized');
            }
    
        } catch (error) {
            this.logger.error(`Error executing admin command ${command}:`, error);
            if (msg?.chat?.id) {
                await this.bot.sendMessage(
                    msg.chat.id, 
                    "An error occurred while processing the admin command.",
                    { message_thread_id: messageThreadId }
                );
            }
        }
    }
    
    

    async handleNonCommand(msg, messageThreadId) {
        try {
            // Récupérer l'état utilisateur
            const userId = msg.from.id;
            const userState = this.stateManager.getUserState(userId);
            
            // Si en attente d'une adresse referral
            if (userState?.context === 'referral' && userState?.step === 'WAITING_ADDRESS') {
                await this.commandHandlersInstance.referralHandler.handleAddressInput(this.bot, msg);
                return;
            }

            if (userState?.action === 'awaiting_custom_threshold') {
                this.logger.debug('Handling custom threshold input');
                await this.commandHandlersInstance.trackingActionHandler.handleCustomThresholdInput(this.bot, msg);
                return;
            }
    
            const messageText = msg.text || '';
            const solanaAddressRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
            if (solanaAddressRegex.test(messageText)) {
                groupMessageLogger.logGroupMessage(msg);
            }
        } catch (error) {
            this.logger.error(`Error handling non-command message:`, error);
        }
    }
    
}

module.exports = MessageHandler;
