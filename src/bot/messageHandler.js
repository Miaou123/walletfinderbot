const CommandParser = require('./commandsManager/commandParser');
const commandRegistry = require('./commandsManager/commandRegistry');
const groupMessageLogger = require('./messageDataManager/groupMessageLogger');
const UserService = require('../database/services/userService');
const logger = require('../utils/logger');

class MessageHandler {
    constructor(dependencies) {
        this.bot = dependencies.bot;
        this.commandHandlersInstance = dependencies.commandHandlers;
        this.accessControl = dependencies.accessControl;
        this.rateLimiter = dependencies.rateLimiter;
        this.config = dependencies.config;
        this.logger = logger;
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
            
            this.logger.info(`Bot initialized with username: ${this.botUsername}`);
        } catch (error) {
            this.logger.error('Failed to initialize MessageHandler:', error);
            throw error;
        }
    }
    
    // Getter for commands requiring authentication
    get limitedCommands() {
        return Object.entries(this.commandConfigs)
            .filter(([_, config]) => config.requiresAuth)
            .map(([command, _]) => command);
    }
    
    // Getter for basic commands (no auth required)
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
    
        // Check message age
        const currentTimestamp = Math.floor(Date.now() / 1000);
        const messageAge = currentTimestamp - msg.date;
        
        if (messageAge > this.MAX_MESSAGE_AGE) {
            this.logger.info(`Ignored old message from user ${username} (ID: ${userId}): ${msg.text}`);
            return;
        }

        // Verify user registration for private messages with commands
        if (!isGroup && msg.text.startsWith('/')) {
            const { command } = this.commandParser.parseCommand(msg.text);
            // Allow /start and /help without registration
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
    
        // Command processing
        if (msg.text.startsWith('/')) {
            const { command, args, isAdmin } = this.commandParser.parseCommand(msg.text);

            if (!command) {
                if (!isGroup) {
                    await this.bot.sendMessage(chatId, "Unknown command. Use /help to see available commands.");
                }
                return;
            }

            // Admin command verification
            if (isAdmin) {
                const isAdminUser = await this.accessControl.isAdmin(userId);
                if (!isAdminUser) {
                    this.logger.warn(`Non-admin user ${username} (ID: ${userId}) tried to use admin command: ${command}`);
                    return;
                }
                await this.handleCommand(msg, isGroup, messageThreadId);
                return;
            }

            // Check if command requires authentication
            const commandConfig = this.commandConfigs[command];
            const requiresAuth = commandConfig?.requiresAuth ?? false;

            if (requiresAuth) {
                if (isGroup) {
                    // Exception for subscribe_group command
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
                    // Check individual user subscription
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
    
        // Prevent /subscribe in groups
        if (isGroup && command === 'subscribe') {
            await this.bot.sendMessage(chatId,
                '❌ You cannot use /subscribe in a group chat. Please use /subscribe_group instead.',
                { message_thread_id: messageThreadId }
            );
            return;
        }
    
        try {
            // Handle admin commands
            if (isAdmin) {
                await this.handleAdminCommand(command, msg, args, messageThreadId);
                return;
            }

            // Show help for commands with no arguments
            const commandConfig = this.commandConfigs[command];
            const showHelpForEmptyArgs = (
                commandConfig && 
                args.length === 0 && 
                !['help', 'start', 'subscribe', 'subscribe_group', 'ping', 
                 'cancel', 'tracker', 'access', 'referral', 'preview'].includes(command)
            );
            
            if (showHelpForEmptyArgs) {
                this.logger.debug(`Showing help for command ${command} due to no arguments`);
                const helpHandler = commandRegistry.getCommandHandler('help');
                if (helpHandler) {
                    await helpHandler.handler(this.bot, msg, [command], messageThreadId);
                    return;
                }
            }
    
            // Anti-spam check
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
                const cmdHandler = commandRegistry.getCommandHandler(command);
                if (cmdHandler && cmdHandler.handler) {
                    await cmdHandler.handler(this.bot, msg, args, messageThreadId);
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
            // Validate message structure
            if (!msg?.chat?.id || !msg?.from?.id) {
                this.logger.error('Invalid message format in handleAdminCommand');
                return;
            }
    
            // Verify user is admin
            const userId = msg.from.id;
            const chatId = String(msg.chat.id);
            
            if (!await this.accessControl.isAdmin(userId)) {
                this.logger.warn(`Non-admin user ${msg.from.username} tried to use admin command: ${command}`);
                await this.bot.sendMessage(chatId, "You are not authorized to use this command.");
                return;
            }
    
            // Use the admin command handler
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
            // Get user state
            const userId = msg.from.id;
            const chatId = msg.chat.id;
            const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
            const inputText = msg.text?.trim()?.toLowerCase() || '';
            
            // Check for cancel commands
            const isCancelCommand = ['cancel', 'stop', '/cancel', '/stop'].includes(inputText);
            if (isCancelCommand) {
                // Clear states but preserve tracking info
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
            
            // For groups, also check group-level state
            if (isGroup) {
                // Check for group chat threshold state
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
                    
                    // Link the user to the group threshold request
                    this.stateManager.setUserState(userId, {
                        action: 'awaiting_custom_threshold',
                        tokenAddress: groupState.tokenAddress,
                        isRespondingToGroup: true,
                        groupStateKey
                    });
                    
                    userState = this.stateManager.getUserState(userId);
                }
            }
            
            // Handle referral address input
            if (userState?.context === 'referral' && userState?.step === 'WAITING_ADDRESS') {
                await this.commandHandlersInstance.referralHandler.handleAddressInput(this.bot, msg);
                return;
            }

            // Handle custom threshold input
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
    
            // Log Solana addresses in group chats
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