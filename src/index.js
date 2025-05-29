require('dotenv').config();
const path = require('path');
const logger = require('./utils/logger');
const { bot } = require('./bot/telegramBot');
const gmgnApi = require('./integrations/gmgnApi'); // Add this import

logger.info('Bot is starting...');

process.on('uncaughtException', (error) => {
  logger.error('UncaughtException:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Browser health monitor - restart browser periodically to prevent connection issues
setInterval(async () => {
    try {
        if (gmgnApi.browser && gmgnApi.browser.connected) {
            const browserAge = Date.now() - (gmgnApi.browserCreatedAt || 0);
            const ageMinutes = Math.round(browserAge / 1000 / 60);
            
            logger.debug(`Browser health check - Age: ${ageMinutes}min, Requests: ${gmgnApi.requestCount}`);
            
            // Proactively restart if getting close to limits
            if (ageMinutes > 12 || gmgnApi.requestCount > 15) {
                logger.info('Proactively restarting browser for health maintenance');
                await gmgnApi.closeBrowser();
            }
        }
    } catch (error) {
        logger.error('Error in browser health check:', error);
    }
}, 5 * 60 * 1000); // Check every 5 minutes

// Graceful shutdown handler
process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    try {
        if (gmgnApi.browser) {
            await gmgnApi.closeBrowser();
            logger.info('Browser closed during shutdown');
        }
    } catch (error) {
        logger.error('Error closing browser during shutdown:', error);
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    try {
        if (gmgnApi.browser) {
            await gmgnApi.closeBrowser();
            logger.info('Browser closed during shutdown');
        }
    } catch (error) {
        logger.error('Error closing browser during shutdown:', error);
    }
    process.exit(0);
});

logger.info('Bot is running with browser health monitoring...');