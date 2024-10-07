const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const winston = require('winston');
const config = require('../config/config');
const commandHandler = require('./commandHandler');
const { parseCommand, validateArgs, commandConfigs, getCommandHelp } = require('./commandParser');
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

const activeCommands = {};

// Initialize AccessControl, RateLimiter, and CommandUsageTracker
const accessControl = new AccessControl(path.join(configPath, 'access.json'));
const rateLimiter = new RateLimiter(path.join(configPath, 'rate_limits.json'));
const usageTracker = new CommandUsageTracker(path.join(configPath, 'command_usage.json'));

// Add this line after initialization to check loaded admins
console.log('Loaded admin users in telegramBot.js:', Array.from(accessControl.adminUsers));

// Set rate limits for commands
const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

Object.entries(commandConfigs).forEach(([cmd, config]) => {
    if (config.dailyLimit !== Infinity) {
        rateLimiter.setLimit(cmd, config.dailyLimit, ONE_DAY_IN_MS);
    }
});
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
                // Gestion de message trop long
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

// Middleware for access control, rate limiting, and usage tracking
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

// Main message handler
bot.on('message', async (msg) => {
    if (!msg.text || !msg.text.startsWith('/')) return;
  
    const { command, args } = parseCommand(msg.text);
    if (!command) {
      await bot.sendLongMessage(msg.chat.id, "Unknown command. Use /help to see available commands.");
      return;
    }

    // Exécution directe des commandes sans arguments
    if (args.length === 0) {
        if (command === 'start') {
            commandHandler.start(bot, msg, args);
            return;
        }
        if (command === 'ping') {
            commandHandler.ping(bot, msg, args);
            return;
        }
        if (command === 'tracker') {
            commandHandler.tracker(bot, msg, args);
            return;
        }
        if (command === 'cancel') {
            commandHandler.cancel(bot, msg, args);
            return;
        }
    }

  if (command === 'help') {
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
            disable_web_page_preview: true // Désactiver l'aperçu des liens pour éviter les grandes prévisualisations.
        });
      } else {
        // Afficher l'aide pour une commande spécifique
        const specificHelpMessage = getCommandHelp(args[0]);
        await bot.sendLongMessage(msg.chat.id, specificHelpMessage, {}, true); // Activer l'aperçu de lien
      }
      return;
    }
  
    // Gestion de la commande "start" directement
    if (command === 'start') {
      await commandHandler.start(bot, msg, args);
      return;
    }
  
    const config = commandConfigs[command];
    if (!config) {
      await bot.Long(msg.chat.id, "Unknown command. Use /help to see available commands.");
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
      console.error(`Error executing command ${command}:`, error);
      await bot.sendLongMessage(msg.chat.id, `An error occurred while processing your request: ${error.message}`);
    }
  });  


bot.onText(/\/adduser (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const adminUsername = msg.from.username;

    console.log('Attempting to add user. Admin:', adminUsername);
    console.log('Is admin?', accessControl.isAdmin(adminUsername));
    
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
            bot.sendLongMessage(chatId, "Invalid user type. Use 'normal', 'vip', or 'admin'.");
            return;
    }

    await accessControl.addUser(newUser, role);
    bot.sendLongMessage(chatId, `User ${newUser} has been added as ${role}.`);
});

// Admin command to remove a user
bot.onText(/\/removeuser (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const adminUsername = msg.from.username;
    
    if (!accessControl.isAdmin(adminUsername)) {
        bot.sendLongMessage(chatId, "You are not authorized to use this command.");
        return;
    }

    const userToRemove = match[1];
    await accessControl.removeUser(userToRemove);
    bot.sendLongMessage(chatId, `User ${userToRemove} has been removed.`);
});

const botCommands = Object.entries(commandConfigs).map(([command, config]) => ({
    command: command,
    description: config.description
  }));

// Définir les commandes pour Telegram
bot.setMyCommands(botCommands);

// Admin command to view usage stats
bot.onText(/\/usagestats/, async (msg) => {
    const chatId = msg.chat.id;
    const adminUsername = msg.from.username;
    
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