const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const winston = require('winston');
const config = require('../config/config');
const commandHandler = require('./commandHandler');
const AccessControl = require('./accessManager/accessControl');
const RateLimiter = require('./accessManager/commandRateLimiter');
const CommandUsageTracker = require('./accessManager/commandUsageTracker');


// Logger configuration
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.simple(),
    transports: [new winston.transports.Console()]
});

// Définir les chemins de base
const basePath = path.resolve(__dirname, '..');
const configPath = path.join(basePath, 'config');

// S'assurer que le répertoire config existe
const fs = require('fs');
if (!fs.existsSync(configPath)) {
    fs.mkdirSync(configPath, { recursive: true });
}

// Initialize AccessControl, RateLimiter, and CommandUsageTracker
const accessControl = new AccessControl(path.join(configPath, 'access.json'));
const rateLimiter = new RateLimiter(path.join(configPath, 'rate_limits.json'));
const usageTracker = new CommandUsageTracker(path.join(configPath, 'command_usage.json'));

// Add this line after initialization to check loaded admins
console.log('Loaded admin users in telegramBot.js:', Array.from(accessControl.adminUsers));

// Set rate limits for commands
const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

rateLimiter.setLimit('th', 5, ONE_DAY_IN_MS);     // 20 uses per day
rateLimiter.setLimit('eb', 5, ONE_DAY_IN_MS);     // 20 uses per day
rateLimiter.setLimit('team', 5, ONE_DAY_IN_MS);   // 40 uses per day
rateLimiter.setLimit('scan', 50, ONE_DAY_IN_MS);   // 20 uses per day
rateLimiter.setLimit('search', 50, ONE_DAY_IN_MS); // 40 uses per day
rateLimiter.setLimit('cross', 20, ONE_DAY_IN_MS);  // 20 uses per day
rateLimiter.setLimit('bt', 5, ONE_DAY_IN_MS);     // 40 uses per day
rateLimiter.setLimit('bundle', 20, ONE_DAY_IN_MS); // 20 uses per day

// Utility functions
function splitMessage(message) {
    const MAX_MESSAGE_LENGTH = 4096;
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

// Initialisez SupplyTracker avec bot et accessControl
commandHandler.initializeSupplyTracker(bot, accessControl);

// Command definitions
const commands = [
    { command: '/start', handler: commandHandler.handleStartCommand },
    { command: '/help', handler: commandHandler.handleHelpCommand },
    { command: '/ping', handler: commandHandler.handlePingCommand },
    { command: '/th', handler: commandHandler.handleAnalyzeCommand, hasArgs: true, requiresAuth: true },
    { command: '/eb', handler: commandHandler.handleEarlyBuyersCommand, hasArgs: true, requiresAuth: true },
    { command: '/team', handler: commandHandler.handleTeamSupplyCommand, hasArgs: true, requiresAuth: true },
    { command: '/scan', handler: commandHandler.handleScanCommand, hasArgs: true, requiresAuth: true },
    { command: '/search', handler: commandHandler.handleSearchCommand, hasArgs: true, requiresAuth: true },
    { command: '/cross', handler: commandHandler.handleCrossCommand, hasArgs: true, requiresAuth: true },
    { command: '/bt', handler: commandHandler.handleBestTradersCommand, hasArgs: true, requiresAuth: true },
    { command: ['/bundle', '/bd'], handler: commandHandler.handleBundleCommand, hasArgs: true, requiresAuth: true },
    { command: '/tracker', handler: commandHandler.handleTrackerCommand, hasArgs: false, requiresAuth: true },
    { command: /^\/stop_(.+)$/, handler: commandHandler.handleStopTracking, hasArgs: true, requiresAuth: true },
];

// Middleware for access control, rate limiting, and usage tracking
const authMiddleware = async (msg, command) => {
    const username = msg.from.username;
    if (!accessControl.isAllowed(username)) {
        await bot.sendMessage(msg.chat.id, "Sorry, you do not have access to this command. Noesis is currently in beta; if you want to participate, please contact @rengon0x via Telegram or Twitter. There are currently X/100 spots available for this beta version.");
        return false;
    }
    if (!accessControl.isVIP(username) && !rateLimiter.isAllowed(username, command)) {
        await bot.sendMessage(msg.chat.id, "Sorry, you've reached the usage limit for this command.");
        return false;
    }
    usageTracker.trackUsage(username, command);
    return true;
};

// Register command handlers (remplacer les deux boucles existantes par celle-ci)
commands.forEach(({ command, handler, hasArgs, requiresAuth }) => {
    const regex = Array.isArray(command) 
        ? new RegExp(`^(${command.join('|')})${hasArgs ? ' (.+)' : ''}$`)
        : new RegExp(`^${command}${hasArgs ? ' (.+)' : ''}$`);
    bot.onText(regex, async (msg, match) => {
        logger.info(`Command triggered: ${Array.isArray(command) ? command.join('/') : command}`);
        if (requiresAuth) {
            const isAuthorized = await authMiddleware(msg, Array.isArray(command) ? command[0].slice(1) : command.slice(1));
            if (!isAuthorized) return;
        }
        handler(bot, msg, match);
    });
});

bot.onText(/\/adduser (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const adminUsername = msg.from.username;

    console.log('Attempting to add user. Admin:', adminUsername);
    console.log('Is admin?', accessControl.isAdmin(adminUsername));
    
    if (!accessControl.isAdmin(adminUsername)) {
        bot.sendMessage(chatId, "You are not authorized to use this command.");
        return;
    }

    const args = match[1].split(' ');
    if (args.length < 2) {
        bot.sendMessage(chatId, "Usage: /adduser <username> <type>\nTypes: normal, vip, admin");
        return;
    }

    const [newUser, userType] = args;
    let role;

    switch(userType.toLowerCase()) {
        case 'normal':
            role = 'user';
            break;
        case 'vip':
            role = 'vip';
            break;
        case 'admin':
            role = 'admin';
            break;
        default:
            bot.sendMessage(chatId, "Invalid user type. Use 'normal', 'vip', or 'admin'.");
            return;
    }

    await accessControl.addUser(newUser, role);
    bot.sendMessage(chatId, `User ${newUser} has been added as ${role}.`);
});

// Admin command to remove a user
bot.onText(/\/removeuser (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const adminUsername = msg.from.username;
    
    if (!accessControl.isAdmin(adminUsername)) {
        bot.sendMessage(chatId, "You are not authorized to use this command.");
        return;
    }

    const userToRemove = match[1];
    await accessControl.removeUser(userToRemove);
    bot.sendMessage(chatId, `User ${userToRemove} has been removed.`);
});



// Admin command to view usage stats
bot.onText(/\/usagestats/, async (msg) => {
    const chatId = msg.chat.id;
    const adminUsername = msg.from.username;
    
    if (!accessControl.isAdmin(adminUsername)) {
        bot.sendMessage(chatId, "You are not authorized to use this command.");
        return;
    }

    const stats = usageTracker.getUsageStats();
    let message = "Command Usage Statistics:\n\n";
    for (const [command, count] of Object.entries(stats)) {
        message += `${command}: ${count} uses\n`;
    }
    bot.sendMessage(chatId, message);
});

// Function to reset daily limits (call this function daily)
async function resetDailyLimits() {
    await rateLimiter.resetDailyLimits();
    console.log('Daily rate limits have been reset.');
}

// Set up a daily reset of rate limits
setInterval(resetDailyLimits, 24 * 60 * 60 * 1000); // Run every 24 hours

// Callback query handler
bot.on('callback_query', (callbackQuery) => {
    commandHandler.handleCallbackQuery(bot, callbackQuery);
});


bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
  });


module.exports = { bot };