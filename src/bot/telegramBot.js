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

    // Vérifier si message est une chaîne
    if (typeof message !== 'string') {
        console.error('Invalid message type:', typeof message);
        return [String(message)]; // Convertir en chaîne si possible
    }

    let currentMessage = '';
    const lines = message.split('\n');

    for (const line of lines) {
        if (currentMessage.length + line.length + 1 <= MAX_MESSAGE_LENGTH) {
            currentMessage += line + '\n';
        } else {
            if (currentMessage) {
                messages.push(currentMessage.trim());
            }
            currentMessage = line + '\n';
        }
    }

    if (currentMessage) {
        messages.push(currentMessage.trim());
    }

    return messages.filter(msg => msg.trim().length > 0);
}

async function sendLongMessage(bot, chatId, message, options = {}) {
    // Vérifier si message est défini et le convertir en chaîne si nécessaire
    if (message === undefined || message === null) {
        console.error('Message is undefined or null');
        return;
    }

    const messageString = String(message);
    const messages = splitMessage(messageString);
    
    for (const msg of messages) {
        if (msg.trim().length > 0) {
            try {
                await bot.sendMessage(chatId, msg, {
                    ...options,
                    parse_mode: 'HTML',
                    disable_web_page_preview: true
                });
            } catch (error) {
                console.error('Error sending message:', error);
                if (error.response && error.response.statusCode === 400 && error.response.body.description.includes('message is too long')) {
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

// Handle /th command
// Gérer la commande /th
bot.onText(/\/th (.+)/, (msg, match) => {
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