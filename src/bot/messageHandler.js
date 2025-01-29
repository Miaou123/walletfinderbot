const CommandParser = require('./commandsManager/commandParser');  // Nouvelle classe
const { getAvailableSpots } = require('../utils/accessSpots');
const groupMessageLogger = require('./messageDataManager/groupMessageLogger');

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
        const chatId = String(msg.chat.id);
        const userId = msg.from?.id; 
    
        // Vérification de l'ancienneté du message
        const currentTimestamp = Math.floor(Date.now() / 1000);
        const messageAge = currentTimestamp - msg.date;
        
        if (messageAge > this.MAX_MESSAGE_AGE) {
            this.logger.info(`Ignored old message from user ${username || msg.from.id}: ${msg.text}`);
            return;
        }
    
        // Vérification initiale des permissions
        if (msg.text.startsWith('/')) {
            const { command, isAdmin } = this.commandParser.parseCommand(msg.text);


            if (!command || (!this.commandConfigs[command] && !this.adminCommandConfigs[command])) {
                if (!isGroup) {
                    await this.bot.sendMessage(chatId, "Unknown command. Use /help to see available commands.");
                }
                return;
            }
            
            const commandConfig = isAdmin ? this.adminCommandConfigs[command] : this.commandConfigs[command];
            const requiresAuth = commandConfig?.requiresAuth ?? true;
        
            let allowed;
            if (isAdmin) {
                allowed = await this.accessControl.isAdmin(userId);
                if (!allowed) {
                    this.logger.warn(`Non-admin user ${username} (ID: ${userId}) tried to use admin command: ${command}`);
                    return;
                }
            } else if (isGroup) {
                // Vérification des groupes
                // Ajouter une exception pour subscribe_group
                if (command !== 'subscribe_group') {  
                    allowed = await this.accessControl.isAllowed(chatId, 'group');
                    if (!allowed && requiresAuth) {
                        await this.bot.sendMessage(chatId,
                            "This group doesn't have an active subscription. Use /subscribe_group to subscribe.",
                            { message_thread_id: messageThreadId }
                        );
                        return;
                    }
                }
            } else {
                // Vérification des utilisateurs normaux
                allowed = await this.accessControl.isAllowed(chatId, 'user');
                if (requiresAuth && !allowed) {
                    const spotsInfo = getAvailableSpots();
                    await this.bot.sendMessage(chatId,
                        `You don't have access to this bot. ${spotsInfo ? `There are currently ${spotsInfo.availableSpots}/${spotsInfo.maxUsers} spots available.` : ''} Please contact @Rengon0x for access.`
                    );
                    return;
                }
            }
        } else if (!this.accessControl.isAllowed(username, chatId)) {
            // Pour les messages non-commandes, on vérifie toujours les permissions
            if (!isGroup) {
                const spotsInfo = getAvailableSpots();
                await this.bot.sendMessage(chatId,
                    `You don't have access to this bot. ${spotsInfo ? `There are currently ${spotsInfo.availableSpots}/${spotsInfo.maxUsers} spots available.` : ''} Please contact @Rengon0x for access.`
                );
            }
            return;
        }
    
        if (isGroup && msg.text) {
            groupMessageLogger.logGroupMessage(msg);
        }
    
        if (msg.text.startsWith('/')) {
            await this.handleCommand(msg, isGroup, messageThreadId);
        } else {
            await this.handleNonCommand(msg, messageThreadId);
        }
    }

    async handleCommand(msg, isGroup, messageThreadId) {
        const { command, args, isAdmin } = this.commandParser.parseCommand(msg.text);
        const userId = msg.from.id;
        const username = msg.from.username;
        const chatId = String(msg.chat.id);

        if (isGroup && command === 'subscribe') {
            await this.bot.sendMessage(chatId,
                '❌ You cannot use /subscribe in a group chat. Please use /subscribe_group instead.',
                { message_thread_id: messageThreadId }
            );
            return;
        }

        this.logger.info(`Received command: ${command} with args: [${args}] from user: ${msg.from.username} (ID: ${userId})`);

        if (!command) {
            if (!isGroup) {
                await this.bot.sendLongMessage(msg.chat.id, "Unknown command. Use /help to see available commands.", { message_thread_id: messageThreadId });
            }
            return;
        }

        // Gestion des commandes admin
        if (isAdmin) {
            await this.handleAdminCommand(command, msg, args, messageThreadId);
            return;
        }

        try {
            // 1. Vérification des permissions de base
            if (this.commandConfigs[command]?.requiresAuth && !await this.accessControl.isAllowed(username, chatId)) {
                if (!isGroup) {
                    await this.bot.sendMessage(chatId,
                        "You don't have access to this command.",
                        { message_thread_id: messageThreadId }
                    );
                }
                return;
            }            

            // 2. Vérification VIP si nécessaire
            if (this.commandConfigs[command]?.requiresVIP && !this.accessControl.isVIP(username, chatId)) {
                if (!isGroup) {
                    await this.bot.sendMessage(chatId,
                        "This command requires VIP access. Please contact an administrator for upgrade.",
                        { message_thread_id: messageThreadId }
                    );
                }
                return;
            }

            // 3. Vérification des limites d'utilisation quotidiennes
            if (!this.accessControl.isVIP(username, chatId) && !this.rateLimiter.isAllowed(username, command)) {
                if (!isGroup) {
                    await this.bot.sendMessage(chatId,
                        "You've reached the usage limit for this command. Please try again later.",
                        { message_thread_id: messageThreadId }
                    );
                }
                return;
            }

            // 4. Validation des arguments
            const validationErrors = this.commandParser.validateArgs(command, args);
            if (validationErrors.length > 0) {
                if (!isGroup) {
                    await this.bot.sendLongMessage(chatId, validationErrors.join('\n\n'), 
                        { message_thread_id: messageThreadId }
                    );
                }
                return;
            }

            // 5. Gestion anti-spam pour toutes les commandes
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

            // 6. Exécution de la commande
            try {
                const handlerName = command.toLowerCase();
                if (typeof this.commandHandlers[handlerName] === 'function') {
                    this.logger.info(`Executing command handler: ${command} for user: ${username} (ID: ${userId})`);
                    await this.commandHandlers[handlerName](this.bot, msg, args, messageThreadId);
                } else {
                    throw new Error(`No handler found for command: ${command}`);
                }                
            } finally {
                // 7. Nettoyage et tracking
                this.ActiveCommandsTracker.removeCommand(userId, command);
            }

        } catch (error) {
            // 8. Gestion des erreurs
            this.logger.error(`Error in command ${command}:`, error);
            if (!isGroup) {
                await this.bot.sendLongMessage(chatId,
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
