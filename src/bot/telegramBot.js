const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const winston = require('winston');
const fs = require('fs');
const config = require('../utils/config');
const commandHandler = require('./commandHandler');
const CommandHandlers = require('./commandHandlers/commandHandlers');
const UserManager = require('./accessManager/userManager');
const ActiveCommandsTracker = require('./commandsManager/activeCommandsTracker');
const { parseCommand, validateArgs, commandConfigs, getCommandHelp } = require('./commandsManager/commandParser');
const AccessControl = require('./accessManager/accessControl');
const RateLimiter = require('./commandsManager/commandRateLimiter');
const CommandUsageTracker = require('./commandsManager/commandUsageTracker');
const groupMessageLogger = require('./messageDataManager/groupMessageLogger');

// Constants
const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 4096;

// Path configurations
const basePath = path.resolve(__dirname, '..');
const configPath = path.join(basePath, 'config');
const userFilePath = path.join(basePath, 'data', 'all_users.json');

// Ensure config directory exists
if (!fs.existsSync(configPath)) {
    fs.mkdirSync(configPath, { recursive: true });
}

// Logger configuration
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.simple(),
    transports: [new winston.transports.Console()]
});

// Initialize managers
const userManagerInstance = new UserManager(userFilePath);
const accessControl = new AccessControl(path.join(configPath, 'access.json'));
const rateLimiter = new RateLimiter(path.join(configPath, 'rate_limits.json'));
const usageTracker = new CommandUsageTracker(path.join(configPath, 'command_usage.json'));
const commandHandlers = new CommandHandlers(userManagerInstance, accessControl);

// Set rate limits for commands
Object.entries(commandConfigs).forEach(([cmd, config]) => {
    if (config.dailyLimit !== Infinity) {
        rateLimiter.setLimit(cmd, config.dailyLimit, ONE_DAY_IN_MS);
    }
});

// Utility function to split long messages
function splitMessage(message) {
    if (typeof message !== 'string') {
        logger.error('Invalid message type:', typeof message);
        return [String(message)];
    }

    const messages = [];
    let currentMessage = '';
    const lines = message.split('\n');

    for (const line of lines) {
        if (currentMessage.length + line.length + 1 <= MAX_MESSAGE_LENGTH) {
            currentMessage += line + '\n';
        } else {
            if (currentMessage) messages.push(currentMessage.trim());
            currentMessage = line + '\n';
        }
    }

    if (currentMessage) messages.push(currentMessage.trim());
    return messages.filter(msg => msg.trim().length > 0);
}

// Function to send long messages
async function sendLongMessage(bot, chatId, message, options = {}) {
    if (message === undefined || message === null) {
        logger.error('Message is undefined or null');
        return;
    }

    const messages = splitMessage(String(message));
    
    for (const msg of messages) {
        if (msg.trim().length > 0) {
            try {
                await bot.sendMessage(chatId, msg, {
                    ...options,
                    parse_mode: 'HTML',
                    disable_web_page_preview: true
                });
            } catch (error) {
                logger.error('Error sending message:', error);
                if (error.response?.statusCode === 400 && error.response?.body.description.includes('message is too long')) {
                    const subMessages = splitMessage(msg);
                    for (const subMsg of subMessages) {
                        await bot.sendMessage(chatId, subMsg, {
                            ...options,
                            parse_mode: 'HTML',
                            disable_web_page_preview: true
                        });
                    }
                } else {
                    throw error;
                }
            }
        }
    }
}

// Bot initialization
const bot = new TelegramBot(config.TELEGRAM_TOKEN, { polling: true });
bot.sendLongMessage = (chatId, message, options) => sendLongMessage(bot, chatId, message, options);

// Function to check users
const checkUsers = () => {
    console.log('Checking users before initializing CommandHandlers:');
    userManagerInstance.debugUsers();
};

// Bot initialization function
const initBot = async () => {
    try {
        logger.info('Starting bot initialization...');
        const me = await bot.getMe();
        bot.options.username = me.username;
        await userManagerInstance.loadUsers();
        await commandHandler.initializeUserManager();
        checkUsers();
        await commandHandler.initializeSupplyTracker(bot, accessControl, userManagerInstance);
        groupMessageLogger.initialize(); 
        logger.info('Bot initialization completed successfully');
    } catch (error) {
        logger.error('Error during bot initialization:', error);
        throw error; 
    }
};

// Initialize the bot
initBot().catch(error => {
    logger.error('Fatal error during bot initialization:', error);
    process.exit(1);
});

// Authentication middleware
const authMiddleware = async (msg, command) => {
    const username = msg.from.username;
    if (!accessControl.isAllowed(username)) {
        await bot.sendLongMessage(msg.chat.id, "Sorry, you do not have access to this command. Noesis is currently in beta; if you want to participate, please contact @Rengon0x via Telegram or Twitter. There are currently X/100 spots available for this beta version.");
        return false;
    }
    
    if (!accessControl.isVIP(username) && !rateLimiter.isAllowed(username, command)) {
        await bot.sendLongMessage(msg.chat.id, "Sorry, you've reached the usage limit for this command.");
        return false;
    }
    usageTracker.trackUsage(username, command);
    return true;
};

// Help command handler
const handleHelp = async (msg, args) => {
    if (args.length === 0) {
        const generalHelpMessage = `
Available commands:

If you are not whitelisted yet please use /access.

If you are already whitelisted:
You can use "/help [command]", "[command] help" or /[command] for a full detail on how the command work.
For example "/help /eb", "/eb help" or "/eb" with no other arguments will give you a full explanation on how the early buyers command works.

/start - Start the bot
/help - Show help information
/access - Show beta access information
/ping - Check bot responsiveness
/scan - Scan a token for top holders
/bundle - Analyze bundle trades
/bt - Analyze best traders
/th - Analyze top holders
/cross - Cross-analyze multiple tokens
/team - Analyze team supply
/search - Search for specific wallets
/eb - Analyze early buyers
/tracker - Show tracked supplies
/cancel - Cancel the current active command

For more information on how to use each command and how they work, please consult our <a href="https://smp-team.gitbook.io/noesis-bot">documentation</a>.

If you have any questions, want to report a bug, or have any suggestions on new features, feel free to DM @Rengon0x on Telegram or Twitter!

⚠️This bot is still in development phase and will probably be subject to many bugs/issues⚠️
`;
        await bot.sendLongMessage(msg.chat.id, generalHelpMessage, {
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
    } else {
        const specificHelpMessage = getCommandHelp(args[0]);
        await bot.sendLongMessage(msg.chat.id, specificHelpMessage, {}, true);
    }
};

// Main message handler
bot.on('message', async (msg) => {
    if (!msg.text) return;

    // Vérifiez si le message provient d'un groupe
    const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';

    if (isGroup && msg.text) {
        groupMessageLogger.logGroupMessage(msg);
      }

    if (msg.text.startsWith('/')) {

        // Vérification pour les groupes
        if (isGroup) {
            const botUsername = bot.options.username; // Assurez-vous que votre instance de bot a cette propriété
            const mentionRegex = new RegExp(`@${botUsername}$`);
            if (!mentionRegex.test(msg.text.split(' ')[0]) && msg.text.includes('@')) {
                // La commande mentionne un autre bot, ignorez-la
                return;
            }
        }

        const { command, args } = parseCommand(msg.text);
        const userId = msg.from.id;

        logger.info(`Received command: ${command} with args: [${args}] from user: ${msg.from.username} (ID: ${userId})`);

        if (!command) {
            await bot.sendLongMessage(msg.chat.id, "Unknown command. Use /help to see available commands.");
            return;
        }

        const limitedCommands = ['scan', 'bundle', 'bt', 'th', 'cross', 'team', 'search', 'eb'];

        // Gestion des commandes sans arguments comme start, ping, tracker, etc.
        if (['start', 'ping', 'tracker', 'cancel', 'help', 'access', 'join'].includes(command)) {
            try {
                if (command === 'help') {
                    await handleHelp(msg, args);
                } else if (typeof commandHandler[command] === 'function') {
                    logger.info(`Executing non-limited command: ${command} for user: ${msg.from.username} (ID: ${userId})`);
                    await commandHandler[command](bot, msg, args);
                } else {
                    logger.error(`Command handler not found for command: ${command}`);
                    await bot.sendLongMessage(msg.chat.id, "Command not found. Please use /help to see available commands.");
                }
            } catch (error) {
                logger.error(`Error handling command ${command}:`, error);
                await bot.sendLongMessage(msg.chat.id, "An unexpected error occurred. Please try again later.");
            }
            return;
        }

        // Récupération de la configuration de la commande
        const config = commandConfigs[command];
        if (!config) {
            await bot.sendLongMessage(msg.chat.id, "Unknown command. Use /help to see available commands.");
            return;
        }

        // Validation des arguments
        const validationErrors = validateArgs(command, args);
        if (validationErrors.length > 0) {
            await bot.sendLongMessage(msg.chat.id, validationErrors.join('\n\n'));
            return;
        }

        // Vérification de l'authentification si nécessaire
        if (config.requiresAuth) {
            const isAuthorized = await authMiddleware(msg, command);
            if (!isAuthorized) return;
        }

        // Vérification du nombre maximum de commandes actives pour les commandes limitées
        if (limitedCommands.includes(command)) {
            if (!ActiveCommandsTracker.canAddCommand(userId, command)) {
                logger.warn(`User ${userId} attempted to start command ${command} but has reached the limit.`);
                await bot.sendLongMessage(msg.chat.id, "You have reached the maximum number of concurrent commands. Please wait for one of your commands to finish before starting a new one.");
                return;
            }

            if (!ActiveCommandsTracker.addCommand(userId, command)) {
                logger.warn(`Failed to add command ${command} for user ${userId}. Maximum limit reached.`);
                await bot.sendLongMessage(msg.chat.id, "You have reached the maximum number of instances for this command. Please wait for one to finish before starting a new one.");
                return;
            }

            logger.debug(`Added command ${command} for user ${userId}. New active count: ${ActiveCommandsTracker.getActiveCommandCount(userId)}`);
        }

        // Exécution de la commande
        try {
            if (typeof commandHandler[command] === 'function') {
                logger.info(`Executing command: ${command} for user: ${msg.from.username} (ID: ${userId}) with args: [${args}]`);
                await commandHandler[command](bot, msg, args);
            } else {
                logger.error(`Command handler not found for command: ${command}`);
                await bot.sendLongMessage(msg.chat.id, "Command not found. Please use /help to see available commands.");
            }
        } catch (error) {
            logger.error(`Error in command handler for command ${command}:`, error);
            await bot.sendLongMessage(msg.chat.id, "An unexpected error occurred while processing the command. Please try again later.");
        } finally {
            // Supprimer la commande de la liste des commandes actives une fois terminée
            if (limitedCommands.includes(command)) {
                ActiveCommandsTracker.removeCommand(userId, command);
                logger.debug(`Removed command ${command} for user ${userId}. New active count: ${ActiveCommandsTracker.getActiveCommandCount(userId)}`);
            }
        }
    } else {
        // Traitement des messages non-commandes (par exemple pour la gestion des états utilisateur)
        try {
            logger.info(`Handling non-command message from user: ${msg.from.username}`);
            await commandHandler.handleMessage(bot, msg);
        } catch (error) {
            logger.error(`Error handling non-command message:`, error);
        }
    }
});

// Admin commands
bot.onText(/\/adduser (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const adminUsername = msg.from.username;
    try {
        if (!accessControl.isAdmin(adminUsername)) {
            bot.sendLongMessage(chatId, "You are not authorized to use this command.");
            return;
        }

        const args = match[1].split(' ');
        if (args.length < 2) {
            bot.sendLongMessage(chatId, "Usage: /adduser <username> <type>\nTypes: normal, vip, admin");
            return;
        }

        const [newUser, userType] = args;
        const roleMap = { normal: 'user', vip: 'vip', admin: 'admin' };
        const role = roleMap[userType.toLowerCase()];

        if (!role) {
            bot.sendLongMessage(chatId, "Invalid user type. Use 'normal', 'vip', or 'admin'.");
            return;
        }

        await accessControl.addUser(newUser, role);
        bot.sendLongMessage(chatId, `User ${newUser} has been added as ${role}.`);
    } catch (error) {
        logger.error('Error in adduser command:', error);
        await bot.sendMessage(msg.chat.id, "An error occurred while adding the user.");
    }
});

bot.onText(/\/removeuser (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const adminUsername = msg.from.username;
    try {
        if (!accessControl.isAdmin(adminUsername)) {
            bot.sendLongMessage(chatId, "You are not authorized to use this command.");
            return;
        }

        const userToRemove = match[1];
        await accessControl.removeUser(userToRemove);
        bot.sendLongMessage(chatId, `User ${userToRemove} has been removed.`);
    } catch (error) {
        logger.error('Error in removeuser command:', error);
        await bot.sendMessage(msg.chat.id, "An error occurred while removing the user.");
    }
});

bot.onText(/^\/broadcast/, async (msg) => {
    await commandHandlers.broadcastHandler.handleBroadcastCommand(bot, msg);
  });

// Usage stats command
bot.onText(/\/usagestats/, async (msg) => {
    const chatId = msg.chat.id;
    const adminUsername = msg.from.username;
    try {
        if (!accessControl.isAdmin(adminUsername)) {
            bot.sendLongMessage(chatId, "You are not authorized to use this command.");
            return;
        }

        const stats = usageTracker.getUsageStats();
        let message = "Command Usage Statistics:\n\n";
        for (const [command, count] of Object.entries(stats)) {
            message += `${command}: ${count} uses\n`;
        }
        bot.sendLongMessage(chatId, message);
    } catch (error) {
        logger.error('Error in usagestats command:', error);
        await bot.sendMessage(msg.chat.id, "An error occurred while fetching usage statistics.");
    }
});

// Set bot commands
const botCommands = Object.entries(commandConfigs).map(([command, config]) => ({
    command: command,
    description: config.description
}));

bot.setMyCommands(botCommands);

// Daily limit reset
async function resetDailyLimits() {
    await rateLimiter.resetDailyLimits();
    logger.info('Daily rate limits have been reset.');
}

setInterval(resetDailyLimits, ONE_DAY_IN_MS);

// Callback query handler
bot.on('callback_query', (callbackQuery) => {
    commandHandler.handleCallbackQuery(bot, callbackQuery);
});

bot.on('polling_error', (error) => {
    logger.error('Polling error:', error);
});

module.exports = { bot };