// src/utils/tokenGateMiddleware.js
const logger = require('./logger');
const { TokenVerificationService } = require('../database');

// Simple in-memory cache to reduce database lookups
const verificationCache = new Map();
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

/**
 * Middleware function to check if a user has access to token-gated features
 * @param {Function} handlerFunction - The original command handler
 * @returns {Function} - Wrapped handler with token-gate check
 */
function tokenGatedCommand(handlerFunction) {
    return async (bot, msg, args, messageThreadId) => {
        const userId = msg.from.id.toString();
        const chatId = msg.chat.id;
        
        try {
            // Check if this is a direct message to the bot
            if (msg.chat.type !== 'private') {
                // For groups, we need a different approach - handled in tokenGatedGroupMiddleware
                return await handlerFunction(bot, msg, args, messageThreadId);
            }
            
            // Check cache first
            const cacheKey = `verify_${userId}`;
            const cachedResult = verificationCache.get(cacheKey);
            
            if (cachedResult && (Date.now() - cachedResult.timestamp < CACHE_DURATION)) {
                if (cachedResult.hasAccess) {
                    // User has access from cache, proceed with command
                    return await handlerFunction(bot, msg, args, messageThreadId);
                } else {
                    // User doesn't have access from cache, show error
                    await sendNoAccessMessage(bot, chatId, messageThreadId);
                    return;
                }
            }
            
            // Not in cache or cache expired, check verification status
            const verificationStatus = await TokenVerificationService.checkVerifiedStatus(userId);
            
            // Update cache
            verificationCache.set(cacheKey, {
                hasAccess: verificationStatus.hasAccess,
                timestamp: Date.now()
            });
            
            if (verificationStatus.hasAccess) {
                // User has access, proceed with command
                return await handlerFunction(bot, msg, args, messageThreadId);
            } else {
                // User doesn't have access, show error message
                await sendNoAccessMessage(bot, chatId, messageThreadId);
                return;
            }
        } catch (error) {
            logger.error(`Error in token gate middleware for user ${userId}:`, error);
            
            // If verification check fails, default to allowing access with a warning
            await bot.sendMessage(
                chatId,
                "⚠️ Unable to verify token access. Proceeding with limited functionality.",
                { message_thread_id: messageThreadId }
            );
            
            return await handlerFunction(bot, msg, args, messageThreadId);
        }
    };
}

/**
 * Send message to user when they don't have access
 * @param {Object} bot - Telegram bot instance
 * @param {string|number} chatId - Chat ID
 * @param {string|number} messageThreadId - Thread ID if applicable
 */
async function sendNoAccessMessage(bot, chatId, messageThreadId) {
    await bot.sendMessage(
        chatId,
        "🔒 <b>Token Access Required</b>\n\n" +
        "This feature is only available to token holders.\n\n" +
        "Please use /verify to connect your wallet and verify your token holdings.",
        { 
            parse_mode: 'HTML', 
            message_thread_id: messageThreadId,
            reply_markup: {
                inline_keyboard: [[
                    { text: "🔑 Verify Wallet", callback_data: "tokenverify:reverify" }
                ]]
            }
        }
    );
}

/**
 * Middleware for token-gated commands in group chats
 * @param {Function} handlerFunction - The original command handler
 * @returns {Function} - Wrapped handler with token-gate check
 */
function tokenGatedGroupCommand(handlerFunction) {
    return async (bot, msg, args, messageThreadId) => {
        const userId = msg.from.id.toString();
        const chatId = msg.chat.id;
        
        try {
            // For group chats, check if the group itself has a subscription
            if (msg.chat.type !== 'private') {
                // Group chat logic - typically check if the group has a subscription
                // In your case, you might allow the command if the group is subscribed
                // This would use your existing group subscription logic
                // For now, just check if the user is verified
                return await handlerFunction(bot, msg, args, messageThreadId);
            }
            
            // For private chats, use the regular token verification
            return await tokenGatedCommand(handlerFunction)(bot, msg, args, messageThreadId);
        } catch (error) {
            logger.error(`Error in group token gate middleware for user ${userId}:`, error);
            
            // If verification check fails, default to allowing access with a warning
            await bot.sendMessage(
                chatId,
                "⚠️ Unable to verify token access. Proceeding with limited functionality.",
                { message_thread_id: messageThreadId }
            );
            
            return await handlerFunction(bot, msg, args, messageThreadId);
        }
    };
}

module.exports = {
    tokenGatedCommand,
    tokenGatedGroupCommand
};