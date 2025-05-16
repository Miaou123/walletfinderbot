// src/utils/tokenGateMiddleware.js
const logger = require('./logger');

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
            
            // Check if we have access control from message context
            const accessControl = msg.accessControl || 
                                 msg.context?.accessControl || 
                                 global.accessControl;
            
            if (!accessControl || !accessControl.tokenVerificationService) {
                logger.error('Token verification service not available in middleware');
                
                // If verification service is not available, default to allowing access
                await bot.sendMessage(
                    chatId,
                    "⚠️ Token verification service is not available. Proceeding with limited functionality.",
                    { message_thread_id: messageThreadId }
                );
                
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
            const verificationStatus = await accessControl.tokenVerificationService.checkVerifiedStatus(userId);
            
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
 * Clear the verification cache for a user
 * @param {string} userId - User ID to clear cache for
 */
function clearVerificationCache(userId) {
    const cacheKey = `verify_${userId}`;
    verificationCache.delete(cacheKey);
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
                // Logic to verify if the group has paid access or subscription
                
                // Access control should be available from message context
                const accessControl = msg.accessControl || 
                                    msg.context?.accessControl || 
                                    global.accessControl;
                                    
                if (!accessControl) {
                    logger.error('Access control not available in group middleware');
                    return await handlerFunction(bot, msg, args, messageThreadId);
                }
                
                // Check if this group has an active subscription
                const hasSubscription = await accessControl.hasActiveGroupSubscription(chatId);
                
                if (hasSubscription) {
                    // Group is subscribed - allow command
                    return await handlerFunction(bot, msg, args, messageThreadId);
                }
                
                // If group isn't subscribed, check if this specific user is verified
                // This allows token holders to use commands in unsubscribed groups
                const cacheKey = `verify_${userId}`;
                const cachedResult = verificationCache.get(cacheKey);
                
                if (cachedResult && (Date.now() - cachedResult.timestamp < CACHE_DURATION)) {
                    if (cachedResult.hasAccess) {
                        // User has access from cache, proceed with command
                        return await handlerFunction(bot, msg, args, messageThreadId);
                    }
                }
                
                // Not in cache, check verification status
                if (accessControl.tokenVerificationService) {
                    const verificationStatus = await accessControl.tokenVerificationService.checkVerifiedStatus(userId);
                    
                    // Update cache
                    verificationCache.set(cacheKey, {
                        hasAccess: verificationStatus.hasAccess,
                        timestamp: Date.now()
                    });
                    
                    if (verificationStatus.hasAccess) {
                        // User is a token holder, allow command
                        return await handlerFunction(bot, msg, args, messageThreadId);
                    }
                }
                
                // Neither group is subscribed nor user is a token holder
                await bot.sendMessage(
                    chatId,
                    "🔒 <b>Access Required</b>\n\n" +
                    "This command requires either:\n" +
                    "• A group subscription (/subscribe_group), or\n" +
                    "• Individual token verification (/verify in private chat with the bot)\n\n" +
                    "Please use one of these methods to gain access.",
                    { 
                        parse_mode: 'HTML', 
                        message_thread_id: messageThreadId 
                    }
                );
                return;
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
    tokenGatedGroupCommand,
    clearVerificationCache
};