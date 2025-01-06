const { parseCommand, validateArgs, isAdminCommand } = require('./commandsManager/commandParser');
const { getAvailableSpots } = require('../utils/accessSpots');
const groupMessageLogger = require('./messageDataManager/groupMessageLogger');
const stateManager = require('../utils/stateManager');

class MessageHandler {
    constructor(dependencies) {
        this.bot = dependencies.bot;
        this.commandHandlers = dependencies.commandHandlers.getHandlers();
        this.accessControl = dependencies.accessControl;
        this.rateLimiter = dependencies.rateLimiter;
        this.usageTracker = dependencies.usageTracker;
        this.config = dependencies.config;
        this.logger = dependencies.logger;
        this.ActiveCommandsTracker = dependencies.ActiveCommandsTracker;
        this.trackingActionHandler = dependencies.commandHandlers.trackingActionHandler;
        this.MAX_MESSAGE_AGE = 600;
        this.commandConfigs = dependencies.commandConfigs;
        console.log('MessageHandler: commandHandlers:', this.commandHandlers);
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
        const chatId = msg.chat.id;
    
        // Vérification de l'ancienneté du message
        const currentTimestamp = Math.floor(Date.now() / 1000);
        const messageAge = currentTimestamp - msg.date;
        
        if (messageAge > this.MAX_MESSAGE_AGE) {
            this.logger.info(`Ignored old message from user ${username || msg.from.id}: ${msg.text}`);
            return;
        }
    
        // Si ce n'est pas une commande et que le message est dans un groupe, on l'ignore
        if (isGroup && !msg.text.startsWith('/')) {
            return;
        }
    
        // Vérification initiale des permissions
        if (msg.text.startsWith('/')) {
            const { command } = parseCommand(msg.text);
            
            // Vérifie si la commande existe et si elle nécessite une authentification
            const commandConfig = this.commandConfigs[command];
            const requiresAuth = commandConfig?.requiresAuth ?? true; // Par défaut, on requiert l'auth si pas de config
            const allowed = await this.accessControl.isAllowed(username, chatId);
    
            if (requiresAuth && !allowed) {
                if (!isGroup) {
                    const spotsInfo = getAvailableSpots();
                    await this.bot.sendMessage(chatId,
                        `You don't have access to this bot. ${spotsInfo ? `There are currently ${spotsInfo.availableSpots}/${spotsInfo.maxUsers} spots available.` : ''} Please contact @Rengon0x for access.`
                    );
                }
                return;
            }
        }
    
        if (isGroup && msg.text) {
            groupMessageLogger.logGroupMessage(msg);
        }
    
        if (msg.text.startsWith('/')) {
            await this.handleCommand(msg, isGroup, messageThreadId);
        } else if (!isGroup) {
            await this.handleNonCommand(msg, messageThreadId);
        }
    }
    

    async handleCommand(msg, isGroup, messageThreadId) {
        const { command, args, isAdmin } = parseCommand(msg.text);
        const userId = msg.from.id;

        if (isGroup) {
            const botUsername = this.bot.options.username;
            const mentionRegex = new RegExp(`@${botUsername}$`);
            if (!mentionRegex.test(msg.text.split(' ')[0]) && msg.text.includes('@')) {
                return;
            }
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
            if (!this.accessControl.isAdmin(msg.from.username)) {
                this.logger.warn(`Non-admin user ${msg.from.username} tried to use admin command: ${command}`);
                return;
            }
            
            // Validation avec les arguments
            const validationErrors = validateArgs(command, args, true);
            if (validationErrors.length > 0) {
                if (!isGroup) {
                    await this.bot.sendLongMessage(msg.chat.id, validationErrors.join('\n\n'), { message_thread_id: messageThreadId });
                }
                return;
            }
            
            await this.handleAdminCommand(command, msg, args, messageThreadId);
            return;
        }

        // Ici on gère toutes les autres commandes (basic ou requiresAuth)
        const username = msg.from.username;
        const chatId = msg.chat.id;

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
            const validationErrors = validateArgs(command, args);
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
                    await this.commandHandlers[handlerName](this.bot, msg, args, messageThreadId);
                } else {
                    throw new Error(`No handler found for command: ${command}`);
                }
            } finally {
                this.ActiveCommandsTracker.removeCommand(userId, command);
                this.usageTracker.trackUsage(username, command);
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
        const handler = this.commandHandlers[command];
        if (typeof handler === 'function') {
            try {
                await handler(this.bot, msg, args, messageThreadId);
            } catch (error) {
                this.logger.error(`Error executing admin command ${command}:`, error);
                await this.bot.sendMessage(msg.chat.id, "An error occurred while processing the admin command.", { message_thread_id: messageThreadId });
            }
        } else {
            await this.bot.sendMessage(msg.chat.id, "No handler implemented for this admin command.", { message_thread_id: messageThreadId });
        }
    }
    
    

    async handleNonCommand(msg, messageThreadId) {
        try {
            const chatId = msg.chat.id;
            const text = msg.text.trim();
            const userState = stateManager.getUserState(chatId);
    
            if (userState?.action === 'awaiting_custom_threshold') {
                const trackingId = userState.trackingId;
                let trackingInfo = stateManager.getTrackingInfo(chatId, trackingId.split('_')[1]);
    
                if (!trackingInfo) {
                    await this.bot.sendMessage(chatId, 
                        "Tracking info not found. Please start over.", 
                        { message_thread_id: messageThreadId }
                    );
                    stateManager.deleteUserState(chatId);
                    return;
                }
    
                const thresholdInput = text.replace('%', '').trim();
                const threshold = parseFloat(thresholdInput);
    
                if (isNaN(threshold) || threshold < 0.1 || threshold > 100) {
                    await this.bot.sendMessage(chatId, 
                        "Invalid input. Please enter a number between 0.1 and 100 for the threshold.", 
                        { message_thread_id: messageThreadId }
                    );
                    return;
                }
    
                trackingInfo.threshold = threshold;
                trackingInfo.awaitingCustomThreshold = false;
                stateManager.setTrackingInfo(chatId, trackingInfo.tokenAddress, trackingInfo);
    
                // Accès au TrackingActionHandler via les dependencies
                await this.trackingActionHandler.updateTrackingMessage(
                    this.bot, 
                    chatId, 
                    trackingInfo
                );
                
                stateManager.deleteUserState(chatId);
            } else {
                await this.bot.sendMessage(chatId, 
                    "I don't understand your message. Please use a command or follow the instructions.", 
                    { message_thread_id: messageThreadId }
                );
            }
        } catch (error) {
            this.logger.error(`Error handling non-command message:`, error);
            await this.bot.sendMessage(msg.chat.id, 
                "An error occurred while processing your message. Please try again.", 
                { message_thread_id: messageThreadId }
            );
        }
    }

}

module.exports = MessageHandler;
