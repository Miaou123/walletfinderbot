const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const winston = require('winston');
const fs = require('fs');
const config = require('../config/config');
const commandHandler = require('./commandHandler');
const { parseCommand, validateArgs, commandConfigs, getCommandHelp } = require('./commandParser');
const AccessControl = require('./accessManager/accessControl');
const RateLimiter = require('./accessManager/commandRateLimiter');
const CommandUsageTracker = require('./accessManager/commandUsageTracker');
const ActiveCommandsTracker = require('./activeCommandsTracker');

// Constants
const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 4096;

// Path configurations
const basePath = path.resolve(__dirname, '..');
const configPath = path.join(basePath, 'config');

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
const accessControl = new AccessControl(path.join(configPath, 'access.json'));
const rateLimiter = new RateLimiter(path.join(configPath, 'rate_limits.json'));
const usageTracker = new CommandUsageTracker(path.join(configPath, 'command_usage.json'));

logger.info('Loaded admin users in telegramBot.js:', Array.from(accessControl.adminUsers));

// Set rate limits for commands
Object.entries(commandConfigs).forEach(([cmd, config]) => {
    if (config.dailyLimit !== Infinity) {
        rateLimiter.setLimit(cmd, config.dailyLimit, ONE_DAY_IN_MS);
    }
});

// Utility functions
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

commandHandler.initializeSupplyTracker(bot, accessControl);

// Middleware
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

// Command handlers
const handleHelp = async (msg, args) => {
    if (args.length === 0) {
        const generalHelpMessage = `
Available commands:

/start - Start the bot
/help - Show help information
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

You can use /[command] for a full detail on how the command work.

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
    if (!msg.text || !msg.text.startsWith('/')) return;
  
    const { command, args } = parseCommand(msg.text);
    if (!command) {
      await bot.sendLongMessage(msg.chat.id, "Unknown command. Use /help to see available commands.");
      return;
    }

    // Vérifiez le nombre de commandes actives pour l'utilisateur
    const userId = msg.from.id;
    if (ActiveCommandsTracker.getActiveCommandCount(userId) >= 2) {
        await bot.sendLongMessage(msg.chat.id, "You have reached the maximum number of concurrent commands. Please wait for one of your commands to finish before starting a new one.");
        return;
    }

    // Direct execution for commands without arguments
    if (args.length === 0) {
        if (['start', 'ping', 'tracker', 'cancel'].includes(command)) {
            await commandHandler[command](bot, msg, args);
            return;
        }
    }

    if (command === 'help') {
        await handleHelp(msg, args);
        return;
    }
  
    const config = commandConfigs[command];
    if (!config) {
      await bot.sendLongMessage(msg.chat.id, "Unknown command. Use /help to see available commands.");
      return;
    }
  
    const validationErrors = validateArgs(command, args);
    if (validationErrors.length > 0) {
      await bot.sendLongMessage(msg.chat.id, validationErrors.join('\n\n'));
      return;
    }
  
    if (config.requiresAuth) {
      const isAuthorized = await authMiddleware(msg, command);
      if (!isAuthorized) return;
    }
  
    try {
      await commandHandler[command](bot, msg, args);
    } catch (error) {
        logger.error('Error in message handler:', error);
        await bot.sendMessage(msg.chat.id, "An unexpected error occurred. Please try again later.");
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
        logger.error('Error in adduser command:', error);
        await bot.sendMessage(msg.chat.id, "An error occurred while adding the user.");
    }
});


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
        logger.error('Error in adduser command:', error);
        await bot.sendMessage(msg.chat.id, "An error occurred while adding the user.");
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