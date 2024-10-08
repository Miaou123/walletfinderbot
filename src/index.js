require('dotenv').config();
const path = require('path');
const logger = require('./utils/logger');
const { bot } = require('./bot/telegramBot');

logger.info('Bot is starting...');

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Ajoutez ici toute autre initialisation nécessaire

logger.info('Bot is running...');