const { parseCommand, validateArgs, isAdminCommand } = require('./commandsManager/commandParser');
const { getAvailableSpots } = require('../utils/accessSpots');
const groupMessageLogger = require('./messageDataManager/groupMessageLogger');

class MessageHandler {
    constructor(dependencies) {
        this.bot = dependencies.bot;
        this.commandHandlers = dependencies.commandHandlers;
        this.commandHandler = dependencies.commandHandler;
        this.accessControl = dependencies.accessControl;
        this.rateLimiter = dependencies.rateLimiter;
        this.usageTracker = dependencies.usageTracker;
        this.config = dependencies.config;
        this.logger = dependencies.logger;
        this.ActiveCommandsTracker = dependencies.ActiveCommandsTracker;
        
        this.limitedCommands = ['scan', 'dexpaid', 'bundle', 'bt', 'th', 'cross', 'team', 'search', 'eb', 'fr', 'entrymap', 'dev'];
        this.basicCommands = ['start', 'ping', 'tracker', 'cancel', 'help', 'access', 'join'];
    }

    async handleMessage(msg) {
        if (!msg.text) return;

        const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
        const messageThreadId = msg.message_thread_id;

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
            const validationErrors = validateArgs(command, args, true);  // true pour indiquer que c'est une commande admin
            if (validationErrors.length > 0) {
                await this.bot.sendLongMessage(msg.chat.id, validationErrors.join('\n\n'), { message_thread_id: messageThreadId });
                return;
            }
            
            await this.handleAdminCommand(command, msg, args, messageThreadId);
            return;
        }

        // Gestion des commandes de base
        if (this.basicCommands.includes(command)) {
            await this.handleBasicCommand(command, msg, args, messageThreadId, userId, isGroup);
            return;
        }

        // Gestion des commandes standard avec validation
        const validationErrors = validateArgs(command, args, false);
        if (validationErrors.length > 0) {
            if (!isGroup) {
                await this.bot.sendLongMessage(msg.chat.id, validationErrors.join('\n\n'), { message_thread_id: messageThreadId });
            }
            return;
        }

        await this.handleStandardCommand(command, msg, args, messageThreadId, userId, isGroup);
    }

    async handleAdminCommand(command, msg, args) {
        try {
            switch (command) {
                case 'adduser':
                    await this.commandHandlers.adminHandler.handleAddUser(this.bot, msg, args);
                    break;
                case 'removeuser':
                    await this.commandHandlers.adminHandler.handleRemoveUser(this.bot, msg, args);
                    break;
                case 'addgroup':
                    await this.commandHandlers.adminHandler.handleAddGroup(this.bot, msg, args);
                    break;
                case 'removegroup':
                    await this.commandHandlers.adminHandler.handleRemoveGroup(this.bot, msg, args);
                    break;
                case 'listgroups':
                    await this.commandHandlers.adminHandler.handleListGroups(this.bot, msg);
                    break;
                case 'usagestats':
                    await this.commandHandlers.adminHandler.handleUsageStats(this.bot, msg, this.usageTracker);
                    break;
                case 'broadcast':
                    await this.commandHandlers.broadcastHandler.handleBroadcastCommand(this.bot, msg);
                    break;
            }
        } catch (error) {
            this.logger.error(`Error in admin command ${command}:`, error);
            await this.bot.sendMessage(msg.chat.id, "An error occurred while processing the admin command.");
        }
    }

    async handleBasicCommand(command, msg, args, messageThreadId, userId, isGroup) {
        try {
            if (command === 'help') {
                await this.handleHelp(msg, args, messageThreadId);
            } else if (typeof this.commandHandler[command] === 'function') {
                this.logger.info(`Executing non-limited command: ${command} for user: ${msg.from.username} (ID: ${userId})`);
                await this.commandHandler[command](this.bot, msg, args, messageThreadId);
            } else {
                this.logger.error(`Command handler not found for command: ${command}`);
                if (!isGroup) {
                    await this.bot.sendLongMessage(msg.chat.id, "Command not found. Please use /help to see available commands.", { message_thread_id: messageThreadId });
                }
            }
        } catch (error) {
            this.logger.error(`Error handling command ${command}:`, error);
            if (!isGroup) {
                await this.bot.sendLongMessage(msg.chat.id, "An unexpected error occurred. Please try again later.", { message_thread_id: messageThreadId });
            }
        }
    }

    async handleStandardCommand(command, msg, args, messageThreadId, userId, isGroup) {
        const validationErrors = validateArgs(command, args);
        if (validationErrors.length > 0) {
            if (!isGroup) {
                await this.bot.sendLongMessage(msg.chat.id, validationErrors.join('\n\n'), { message_thread_id: messageThreadId });
            }
            return;
        }

        if (this.config.requiresAuth && !(await this.authMiddleware(msg, command))) {
            return;
        }

        if (this.limitedCommands.includes(command)) {
            if (!await this.handleLimitedCommand(command, msg, args, messageThreadId, userId, isGroup)) {
                return;
            }
        }

        try {
            const handlerName = command.toLowerCase();
            if (this.commandHandlers[handlerName] && typeof this.commandHandlers[handlerName].handleCommand === 'function') {
                this.logger.info(`Executing new command handler: ${command} for user: ${msg.from.username} (ID: ${userId}) with args: [${args}]`);
                await this.commandHandlers[handlerName].handleCommand(this.bot, msg, args, messageThreadId);
            } else if (typeof this.commandHandler[command] === 'function') {
                this.logger.info(`Executing command: ${command} for user: ${msg.from.username} (ID: ${userId}) with args: [${args}]`);
                await this.commandHandler[command](this.bot, msg, args, messageThreadId);
            } else {
                this.logger.error(`Command handler not found for command: ${command}`);
                if (!isGroup) {
                    await this.bot.sendLongMessage(msg.chat.id, "Command not found. Please use /help to see available commands.", { message_thread_id: messageThreadId });
                }
            }
        } catch (error) {
            this.logger.error(`Error in command handler for command ${command}:`, error);
            if (!isGroup) {
                await this.bot.sendLongMessage(msg.chat.id, "An unexpected error occurred while processing the command. Please try again later.", { message_thread_id: messageThreadId });
            }
        } finally {
            if (this.limitedCommands.includes(command)) {
                this.ActiveCommandsTracker.removeCommand(userId, command);
                this.logger.debug(`Removed command ${command} for user ${userId}. New active count: ${this.ActiveCommandsTracker.getActiveCommandCount(userId)}`);
            }
        }
    }

    async handleLimitedCommand(command, msg, args, messageThreadId, userId, isGroup) {
        if (!this.ActiveCommandsTracker.canAddCommand(userId, command)) {
            this.logger.warn(`User ${userId} attempted to start command ${command} but has reached the limit.`);
            if (!isGroup) {
                await this.bot.sendLongMessage(msg.chat.id, "You have reached the maximum number of concurrent commands. Please wait for one of your commands to finish before starting a new one.", { message_thread_id: messageThreadId });
            }
            return false;
        }

        if (!this.ActiveCommandsTracker.addCommand(userId, command)) {
            this.logger.warn(`Failed to add command ${command} for user ${userId}. Maximum limit reached.`);
            if (!isGroup) {
                await this.bot.sendLongMessage(msg.chat.id, "You have reached the maximum number of instances for this command. Please wait for one to finish before starting a new one.", { message_thread_id: messageThreadId });
            }
            return false;
        }

        this.logger.debug(`Added command ${command} for user ${userId}. New active count: ${this.ActiveCommandsTracker.getActiveCommandCount(userId)}`);
        return true;
    }

    async authMiddleware(msg, command) {
        const spotsInfo = getAvailableSpots();
      
        if (spotsInfo === null) {
            await this.bot.sendLongMessage(msg.chat.id, "An error occurred while processing your request. Please try again later.");
            return false;
        }
      
        const { availableSpots, maxUsers } = spotsInfo;
        const username = msg.from.username;
        
        // Check for group permissions if it's a group chat
        const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
        const chatId = isGroup ? msg.chat.id : null;
        
        if (!this.accessControl.isAllowed(username, chatId)) {
            await this.bot.sendLongMessage(msg.chat.id, `Sorry, you do not have access to this command. Noesis is currently in beta; if you want to participate, please contact @Rengon0x via Telegram or Twitter. There are currently ${availableSpots}/${maxUsers} spots available for this beta version.`);
            return false;
        }
        
        if (!this.accessControl.isVIP(username, chatId) && !this.rateLimiter.isAllowed(username, command)) {
            await this.bot.sendLongMessage(msg.chat.id, "Sorry, you've reached the usage limit for this command.");
            return false;
        }
        
        this.usageTracker.trackUsage(username, command);
        return true;
    }

    async handleNonCommand(msg, messageThreadId) {
        try {
            await this.commandHandler.handleMessage(this.bot, msg, messageThreadId);
        } catch (error) {
            this.logger.error(`Error handling non-command message:`, error);
        }
    }

    async handleHelp(msg, args, messageThreadId) {
        if (args.length === 0) {
            await this.sendGeneralHelp(msg, messageThreadId);
        } else {
            await this.sendSpecificHelp(msg, args[0], messageThreadId);
        }
    }

    async sendGeneralHelp(msg, messageThreadId) {
        const generalHelpMessage = `
Available commands:

If you are not whitelisted yet please use /access.

If you are already whitelisted:
You can use "/help [command]", "[command] help" or /[command] for a full detail on how the command work.
For example "/help /eb", "/eb help" or "/eb" with no other arguments will give you a full explanation on how the early buyers command works.

/start - Start the bot
/help - Show help
/access - Show beta access information
/ping - Check if bot is online
/scan (/s) - Scan a token for a top holders analysis
/bundle (/bd) - Analyze bundle
/freshratio (/fr) - Analyze the proportion of fresh wallets buying a token over a specific time frame. 
/earlybuyers (/eb) - Analyze early buyers on a given timeframe
/besttraders (/bt) - Analyze the 100 best traders
/topholders (/th) - Analyze top holders
/cross (/c) - Find common holders between multiple tokens
/crossbt (/cbt) - Find common holders between the top traders of multiple tokens (realized and unrealized PnL)
/team (/t) - Analyze team supply with an homemade algorithm (works for fresh launches and CTOs)
/search (/sh) - Search for specific wallets with only a part of their address
/dp - Show if dexscreener is paid for a token, also shows adds/boosts.
/em - Show the entryMap for the top holders of a token.
/tracker - Show tracked supplies
/cancel - Cancel the current active command

For more information on how to use each command and how they work, please consult our <a href="https://smp-team.gitbook.io/noesis-bot">documentation</a>.

If you have any questions, want to report a bug, or have any suggestions on new features, feel free to DM @Rengon0x on Telegram or Twitter!

⚠️This bot is still in development phase and will probably be subject to many bugs/issues⚠️
`;
        await this.bot.sendLongMessage(msg.chat.id, generalHelpMessage, {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            message_thread_id: messageThreadId
        });
    }

    async sendSpecificHelp(msg, command, messageThreadId) {
        const { getCommandHelp } = require('./commandsManager/commandParser');
        const specificHelpMessage = getCommandHelp(command);
        await this.bot.sendLongMessage(msg.chat.id, specificHelpMessage, { message_thread_id: messageThreadId }, true);
    }
}

module.exports = MessageHandler;