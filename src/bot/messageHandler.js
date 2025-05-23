const CommandParser = require('./commandsManager/commandParser');  // Nouvelle classe
const CommandUsageService = require('../database/services/commandUsageService');
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
        
        // Save instance for external access
        MessageHandler.instance = this;
    }

    async initialize() {
        try {
            const botInfo = await this.bot.getMe();
            this.botUsername = botInfo.username;
            this.commandParser = new CommandParser(this.botUsername);
            
            // Récupérer les handlers après leur initialisation
            this.commandHandlers = this.commandHandlersInstance.getHandlers();
            
            // Track token verification check timing
            this.lastVerificationChecks = new Map();
            this.verificationCacheTime = 5 * 60 * 1000; // 5 minutes cache
            
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
    
        if (!msg.text) {
            return;
        }
    
        const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
        const messageThreadId = msg.message_thread_id;
        const username = msg.from.username || null; // Allow null username
        const userId = msg.from.id.toString();
        const chatId = msg.chat.id.toString();
    
        // Age check stays the same...
        const currentTimestamp = Math.floor(Date.now() / 1000);
        const messageAge = currentTimestamp - msg.date;
        
        if (messageAge > this.MAX_MESSAGE_AGE) {
            this.logger.info(`Ignored old message from user ${username || userId} (ID: ${userId}): ${msg.text}`);
            return;
        }
    
        // Registration check for private messages (allow commands without username for free commands)
        if (!isGroup && msg.text.startsWith('/')) {
            const { command } = this.commandParser.parseCommand(msg.text);
            if (command !== 'start' && command !== 'help') {
                const isRegistered = await UserService.isUserRegistered(userId);
                if (!isRegistered) {
                    this.logger.debug(`Unregistered user ${username || userId} (${userId}) attempted to use command: ${command}`);
                    await this.bot.sendMessage(chatId,
                        "⚠️ Please /start the bot before using any commands.",
                        { message_thread_id: messageThreadId }
                    );
                    return;
                }
            }
        }
        
        // Command handling
        if (msg.text.startsWith('/')) {
            const { command, isAdmin } = this.commandParser.parseCommand(msg.text);
    
            if (!command) {
                if (!isGroup) {
                    await this.bot.sendMessage(chatId, "Unknown command. Use /help to see available commands.");
                }
                return;
            }
    
            // Admin commands
            if (isAdmin) {
                const isAdminUser = await this.accessControl.isAdmin(userId);
                if (!isAdminUser) {
                    this.logger.warn(`Non-admin user ${username || userId} (ID: ${userId}) tried to use admin command: ${command}`);
                    return;
                }
                await this.handleCommand(msg, isGroup, messageThreadId, username);
                return;
            }
    
            // Check command requirements
            const commandConfig = this.commandConfigs[command];
            const requiresAuth = commandConfig?.requiresAuth ?? false;
            const requiresToken = commandConfig?.requiresToken ?? false;
    
            // Username check for premium commands in PRIVATE chats only
            if (!isGroup && (requiresAuth || requiresToken) && !username) {
                // Skip username check for subscription and verify commands themselves
                if (command !== 'subscribe' && command !== 'verify') {
                    await this.bot.sendMessage(chatId,
                        "🔒 <b>Username Required</b>\n\n" +
                        "Premium commands require a Telegram username.\n\n" +
                        "Please:\n" +
                        "1. Go to Telegram Settings\n" +
                        "2. Set a username\n" +
                        "3. Try the command again\n\n" +
                        "Free commands like /help and /ping work without a username.",
                        { 
                            parse_mode: 'HTML',
                            message_thread_id: messageThreadId 
                        }
                    );
                    return;
                }
            }
    
            // Token verification check (existing logic)
            if (requiresToken && !isGroup) {
                const hasTokenVerification = await this.accessControl.hasTokenVerification(userId);
                
                if (!hasTokenVerification && command !== 'verify') {
                    await this.bot.sendMessage(chatId,
                        "🔒 <b>Token Verification Required</b>\n\n" +
                        `This premium command is <b>exclusively available</b> to token holders.\n\n` +
                        "• Use /verify to start the verification process (<b>no wallet connection necessary</b>)\n" +
                        `• You need to hold our token to access this feature\n\n` +
                        "This command cannot be accessed via subscription.",
                        { 
                            parse_mode: 'HTML',
                            message_thread_id: messageThreadId,
                            reply_markup: {
                                inline_keyboard: [[
                                    { text: "🔑 Start Verification", callback_data: "tokenverify:reverify" }
                                ]]
                            }
                        }
                    );
                    return;
                }
            }
    
            // Regular auth check (existing logic)
            if (requiresAuth) {
                if (isGroup) {
                    // Group logic - username not required
                    if (command !== 'subscribe_group' && command !== 'verifygroup') {
                        const hasActiveGroupSub = await this.accessControl.hasActiveGroupSubscription(chatId);
                        
                        let hasGroupVerification = false;
                        try {
                            hasGroupVerification = !hasActiveGroupSub ? 
                                await this.accessControl.hasGroupTokenVerification(chatId) : false;
                        } catch (error) {
                            this.logger.error(`Error checking group verification: ${error.message}`);
                        }
                        
                        let userHasAccess = false;
                        if (!hasActiveGroupSub && !hasGroupVerification) {
                            try {
                                userHasAccess = await this.accessControl.hasTokenVerification(userId);
                            } catch (error) {
                                this.logger.error(`Error checking token verification for user in group: ${error.message}`);
                            }
                        }
                        
                        if (!hasActiveGroupSub && !hasGroupVerification && !userHasAccess) {
                            await this.bot.sendMessage(chatId,
                                "🔒 <b>Access Required</b>\n\n" +
                                "This command requires access which you can get through:\n\n" +
                                "1️⃣ <b>Group Subscription</b>\n" +
                                "• Use /subscribe_group to subscribe this group\n\n" + 
                                "2️⃣ <b>Group Verification</b>\n" +
                                "• Use /verifygroup to verify this group with tokens (<b>no wallet connection necessary</b>)\n\n" +
                                "3️⃣ <b>Individual Access</b>\n" +
                                "• Members can use /verify in private chat with the bot\n\n" +
                                "Try /preview to test our features\n\n" +
                                "Need help? Contact @Rengon0x for support",
                                { 
                                    parse_mode: 'HTML',
                                    message_thread_id: messageThreadId 
                                }
                            );
                            return;
                        }
                    }
                } else {
                    // Private chat - check user access
                    const hasAccess = await this.accessControl.isAllowed(userId, 'user', username);
                    
                    if (!hasAccess && command !== 'subscribe' && command !== 'verify') {
                        await this.bot.sendMessage(chatId,
                            "🔒 <b>Access Required</b>\n\n" +
                            "This command requires access which you can get through either:\n\n" +
                            "1️⃣ <b>Subscription</b>\n" +
                            "• Use /subscribe to view our subscription plans\n\n" + 
                            "2️⃣ <b>Token Verification</b>\n" +
                            "• Use /verify to start the verification process (<b>no wallet connection necessary</b>)\n\n" +
                            "Try /preview to test our features before subscribing/verifying\n\n" +
                            "Need help? Contact @Rengon0x for support",
                            { parse_mode: 'HTML' }
                        );
                        return;
                    }
                }
            }
    
            await this.handleCommand(msg, isGroup, messageThreadId, username);
        } else {
            await this.handleNonCommand(msg, messageThreadId);
        }
    }    
    
    async handleCommand(msg, isGroup, messageThreadId, username) { 
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
            // Only show help if:
            // 1. Command exists and needs arguments (minArgs > 0)
            // 2. No arguments were provided
            // 3. Not one of the special commands that always execute
            if (commandConfig && commandConfig.minArgs > 0 && args.length === 0 && 
                command !== 'help' && command !== 'start' && 
                command !== 'subscribe' && command !== 'subscribe_group' && command !== 'ping' && 
                command !== 'cancel' && command !== 'tracker' && command !== 'access' && 
                command !== 'referral' && command !== 'preview' && command !== 'walletsearch') {
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
                    
                    await CommandUsageService.trackCommandUsage(command, userId, username, isAdmin);
                    
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
            const chatId = msg.chat.id;
            const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
            const inputText = msg.text?.trim()?.toLowerCase() || '';
            
            // Check for explicit cancellation words
            const isCancelCommand = ['cancel', 'stop', '/cancel', '/stop'].includes(inputText);
            if (isCancelCommand) {
                // Clear input states for this chat if cancel command is detected
                // But preserve tracking info
                if (typeof this.stateManager.cleanAllChatStates === 'function') {
                    const count = this.stateManager.cleanAllChatStates(chatId, { preserveTrackingInfo: true });
                    if (count > 0) {
                        this.logger.debug(`Cancelled operation via text command. Cleaned ${count} states`);
                        await this.bot.sendMessage(chatId, "Operation cancelled.", { message_thread_id: messageThreadId });
                        return;
                    }
                }
            }
            
            // Check individual user state
            let userState = this.stateManager.getUserState(userId);

            // Check if the wallet search handler is waiting for custom input
            if (userState?.context === 'walletSearch' && userState.data?.pendingCriteria) {
                try {
                    // Try to handle custom input for wallet search
                    if (this.commandHandlersInstance.walletSearcherHandler.handleCustomInput) {
                        const handled = await this.commandHandlersInstance.walletSearcherHandler.handleCustomInput(
                            this.bot, 
                            msg
                        );
                        if (handled) return; // Message was handled
                    }
                } catch (error) {
                    this.logger.error('Error handling wallet search custom input:', error);
                }
            }
            
            // For groups, also check group-level state
            if (isGroup) {
                // Check for group chat threshold state with any active requests
                const groupStateKey = `grp_${chatId}`;
                const groupState = this.stateManager.getUserState(groupStateKey);
                
                if (groupState && groupState.action === 'awaiting_custom_threshold') {
                    this.logger.debug('Found group threshold request state:', {
                        groupStateKey,
                        groupState,
                        fromUser: msg.from.username || userId
                    });
                    
                    // Record which user is responding to the threshold request
                    groupState.respondingUserId = userId;
                    this.stateManager.setUserState(groupStateKey, groupState);
                    
                    // Set temporary individual state for this user to link them to the group threshold request
                    this.stateManager.setUserState(userId, {
                        action: 'awaiting_custom_threshold',
                        tokenAddress: groupState.tokenAddress,
                        isRespondingToGroup: true,
                        groupStateKey
                    });
                    
                    userState = this.stateManager.getUserState(userId);
                }
            }
            
            // Si en attente d'une adresse referral
            if (userState?.context === 'referral' && userState?.step === 'WAITING_ADDRESS') {
                await this.commandHandlersInstance.referralHandler.handleAddressInput(this.bot, msg);
                return;
            }

            if (userState?.action === 'awaiting_custom_threshold') {
                this.logger.debug('Handling custom threshold input', {
                    isGroup,
                    fromUser: msg.from.username || userId,
                    userState,
                    text: inputText
                });
                
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
