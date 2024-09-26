const TelegramBot = require('node-telegram-bot-api');
const config = require('../utils/config');
const {
    initializeSupplyTracker,
    handleStartCommand,
    handleHelpCommand,
    handleAnalyzeCommand,
    handleEarlyBuyersCommand,
    handleCrossCommand,
    handleTeamSupplyCommand,
    handleScanCommand,
    handleCallbackQuery,
    handleMessage,
    handleSearchCommand
} = require('./commandHandler');

function splitMessage(message) {
    const MAX_MESSAGE_LENGTH = 4096;
    const messages = [];
    let currentMessage = '';
    let walletBuffer = '';

    // If the message is empty or only whitespace, return an empty array
    if (!message || message.trim().length === 0) {
        return [];
    }

    const lines = message.split('\n');

    for (const line of lines) {
        if (currentMessage.length + line.length + 1 <= MAX_MESSAGE_LENGTH) {
            currentMessage += line + '\n';
            if (line.startsWith('└')) {
                walletBuffer += currentMessage;
                currentMessage = '';
            }
        } else {
            if (walletBuffer) {
                messages.push(walletBuffer.trim());
                walletBuffer = '';
            }
            if (currentMessage) {
                messages.push(currentMessage.trim());
                currentMessage = '';
            }
            currentMessage = line + '\n';
        }
    }

    if (walletBuffer) {
        messages.push(walletBuffer.trim());
    }
    if (currentMessage) {
        messages.push(currentMessage.trim());
    }

    // Filter out any empty messages
    return messages.filter(msg => msg.trim().length > 0);
}

async function sendLongMessage(bot, chatId, message, options = {}) {
    const messages = splitMessage(message);
    
    if (messages.length === 0) {
        console.warn("Attempted to send an empty message. Skipping.");
        return;
    }

    for (const msg of messages) {
        if (msg.trim().length > 0) {
            await bot.sendMessage(chatId, msg, {
                ...options,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });
        }
    }
}





// Create a new bot instance
const bot = new TelegramBot(config.TELEGRAM_TOKEN, { polling: true });

// Initialiser le TeamSupplyTracker
initializeSupplyTracker(bot);

// Attach sendLongMessage to the bot object
bot.sendLongMessage = (chatId, message, options) => sendLongMessage(bot, chatId, message, options);

// Handle /start command
bot.onText(/\/start/, (msg) => {
    handleStartCommand(bot, msg);
  });
  
// Handle /help command
bot.onText(/\/help/, (msg) => {
handleHelpCommand(bot, msg);
});

// Handle /analyze command
// Gérer la commande /analyze
bot.onText(/\/analyze (.+)/, (msg, match) => {
    handleAnalyzeCommand(bot, msg, match);
  });

// Handle /eb command (for early buyers analysis)
bot.onText(/\/eb (.+)/, (msg, match) => {
    console.log("EB command triggered:", msg, match);
    handleEarlyBuyersCommand(bot, msg, match);
});

bot.onText(/\/team (.+)/, (msg, match) => {
    handleTeamSupplyCommand(bot, msg, match);
});

bot.onText(/\/scan (.+)/, (msg, match) => {
    handleScanCommand(bot, msg, match);
  });


  bot.onText(/\/search (.+)/, (msg, match) => {
    handleSearchCommand(bot, msg, match);
  });
// Handle text messages (for future interactions)
bot.on('message', (msg) => {
  if (msg.text.toString().toLowerCase().includes('hello')) {
    bot.sendLongMessage(msg.chat.id, 'Hello! How can I help you?');
  }
});

bot.onText(/\/cross(.*)/, (msg, match) => {
    console.log('Cross command triggered in main file');
    try {
      handleCrossCommand(bot, msg, match);
    } catch (error) {
      console.error('Error in cross command:', error);
      bot.sendLongMessage(msg.chat.id, `An error occurred: ${error.message}`);
    }
  });


bot.on('callback_query', (callbackQuery) => {
    handleCallbackQuery(bot, callbackQuery);
});

// Add this new event listener for messages
bot.on('message', async (msg) => {
    await handleMessage(bot, msg);
});

// Dans telegramBot.js
module.exports = {
    bot
};