// src/bot/commandHandlers/tokenVerifyHandler.js
const BaseHandler = require('./baseHandler');
const logger = require('../../utils/logger');
const { TokenVerificationService } = require('../../database'); // Import directly
const config = require('../../utils/config');

class TokenVerifyHandler extends BaseHandler {
    constructor(accessControl) {
        super();
        this.commandName = 'verify';
        this.accessControl = accessControl;
        this.tokenVerificationService = TokenVerificationService; // Use directly imported service
        this.TOKEN_ADDRESS = config.TOKEN_ADDRESS || process.env.TOKEN_ADDRESS;
        this.TOKEN_SYMBOL = config.TOKEN_SYMBOL || process.env.TOKEN_SYMBOL || 'tokens';
        this.MIN_TOKEN_THRESHOLD = parseInt(config.MIN_TOKEN_THRESHOLD || process.env.MIN_TOKEN_THRESHOLD || '1');
    }

    generateCallbackData(action, params = {}) {
        let callbackData = `tokenverify:${action}`;
        if (params.sessionId) {
            callbackData += `:${params.sessionId}`;
        }
        return callbackData;
    }

    async formatVerificationMessage(session) {
        let message = `🔐 <b>Wallet Verification</b>\n\n`;
        message += `To verify your wallet and access token-gated features, please send ${session.verificationAmount} ${this.TOKEN_SYMBOL} to this address:\n\n`;
        message += `<code>${session.paymentAddress}</code>\n\n`;
        message += `After sending, click the "Check Verification" button below.\n\n`;
        message += `Note: You must have at least ${this.MIN_TOKEN_THRESHOLD} ${this.TOKEN_SYMBOL} in your wallet after verification to access premium features.\n\n`;
        message += `This verification will expire in 30 minutes.`;
        
        return message;
    }

    createVerificationCheckButton(sessionId) {
        return {
            text: '✅ Check Verification',
            callback_data: this.generateCallbackData('check', { sessionId })
        };
    }

    async handleCommand(bot, msg, args, messageThreadId) {
        const userId = msg.from.id.toString();
        const chatId = msg.chat.id.toString(); 
        const username = (msg.from.username || '').toLowerCase().replace(/^@/, '');
        
        try {
            // Use the directly imported service instead of relying on accessControl
            // Check if user is already verified
            const verifiedStatus = await this.tokenVerificationService.checkVerifiedStatus(userId);
            
            if (verifiedStatus.hasAccess) {
                // User is already verified
                await bot.sendMessage(
                    chatId,
                    `✅ You are already verified!\n\n` +
                    `Your wallet: \`${verifiedStatus.walletAddress.substring(0, 6)}...${verifiedStatus.walletAddress.substring(verifiedStatus.walletAddress.length - 4)}\`\n` +
                    `Token balance: ${verifiedStatus.tokenBalance} ${this.TOKEN_SYMBOL}\n\n` +
                    `You have access to all token-gated features.`,
                    { 
                        parse_mode: 'Markdown',
                        message_thread_id: messageThreadId,
                        reply_markup: {
                            inline_keyboard: [[
                                { 
                                    text: "🔄 Update Verification", 
                                    callback_data: this.generateCallbackData('reverify') 
                                }
                            ]]
                        }
                    }
                );
                return;
            }
            
            // Create verification session
            const session = await this.tokenVerificationService.createVerificationSession(
                userId,
                username,
                chatId
            );
            
            // Send verification instructions
            const message = await this.formatVerificationMessage(session);
            
            await bot.sendMessage(
                chatId,
                message,
                {
                    parse_mode: 'HTML',
                    message_thread_id: messageThreadId,
                    reply_markup: {
                        inline_keyboard: [[
                            this.createVerificationCheckButton(session.sessionId)
                        ]]
                    }
                }
            );
        } catch (error) {
            logger.error(`Error in token verification for user ${userId}:`, error);
            await bot.sendMessage(
                chatId,
                "An error occurred while processing your verification request. Please try again later.",
                { message_thread_id: messageThreadId }
            );
        }
    }
    
    async handleCallback(bot, query) {
        try {
            const [category, action, sessionId] = query.data.split(':');
            const userId = query.from.id.toString();
            const chatId = query.message.chat.id;
            
            switch (action) {
                case 'check':
                    await this.handleVerificationCheck(bot, query, sessionId);
                    break;
                case 'reverify':
                    await this.handleCommand(
                        bot, 
                        { from: query.from, chat: query.message.chat },
                        [],
                        query.message.message_thread_id
                    );
                    break;
                default:
                    throw new Error(`Unknown token verification action: ${action}`);
            }
            
            await bot.answerCallbackQuery(query.id);
        } catch (error) {
            logger.error('Error in token verification callback:', error);
            await bot.answerCallbackQuery(query.id, { 
                text: "An error occurred", 
                show_alert: true 
            });
        }
    }
    
    async handleVerificationCheck(bot, query, sessionId) {
        const userId = query.from.id.toString();
        const chatId = query.message.chat.id;
        
        try {
            // Show processing message
            await bot.editMessageText(
                "⏳ Checking your verification transaction...",
                {
                    chat_id: chatId,
                    message_id: query.message.message_id
                }
            );
            
            // Get the verification session first to get the paymentAddress
            const session = await this.tokenVerificationService.getVerificationSession(sessionId);
            if (!session) {
                logger.error(`Verification session not found: ${sessionId}`);
                await bot.editMessageText(
                    "❌ Verification session not found. Please start a new verification.",
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        reply_markup: {
                            inline_keyboard: [[
                                { 
                                    text: "🔄 Start New Verification", 
                                    callback_data: this.generateCallbackData('reverify') 
                                }
                            ]]
                        }
                    }
                );
                return;
            }
            
            logger.debug(`Verification session found: ${sessionId}, payment address: ${session.paymentAddress}`);
            
            // Check verification
            const result = await this.tokenVerificationService.checkVerification(sessionId);
            logger.debug(`Verification result:`, result);
            
            if (result.success) {
                if (result.alreadyVerified) {
                    await bot.editMessageText(
                        "✅ Your wallet is already verified! You have access to token-gated features.",
                        {
                            chat_id: chatId,
                            message_id: query.message.message_id
                        }
                    );
                } else {
                    await this.processSuccessfulVerification(bot, query, result);
                }
            } else {
                await this.handleFailedVerification(bot, query, result);
            }
        } catch (error) {
            logger.error(`Error checking verification for session ${sessionId}:`, error);
            
            await bot.editMessageText(
                "❌ An error occurred while checking your verification. Please try again.",
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    reply_markup: {
                        inline_keyboard: [[
                            this.createVerificationCheckButton(sessionId)
                        ]]
                    }
                }
            );
        }
    }
    
    async processSuccessfulVerification(bot, query, result) {
        const chatId = query.message.chat.id;
        
        const shortAddress = `${result.walletAddress.substring(0, 6)}...${result.walletAddress.substring(result.walletAddress.length - 4)}`;
        
        let message = "🎉 <b>Wallet Successfully Verified!</b>\n\n" +
                     `Your wallet (<code>${shortAddress}</code>) has been verified.\n\n`;
                     
        // If we have a note about token balance checking being skipped, show a different message
        if (result.note) {
            message += `Verification status: <b>Successful</b>\n\n` +
                      `<i>Note: ${result.note}</i>\n\n` +
                      "You now have access to all token-gated features.";
        } else {
            message += `Current balance: ${result.tokenBalance} ${this.TOKEN_SYMBOL}\n` +
                      `Required balance: ${this.MIN_TOKEN_THRESHOLD} ${this.TOKEN_SYMBOL}\n\n` +
                      "You now have access to all token-gated features.\n\n" +
                      `<i>Note: Your access will be automatically revoked if your token balance falls below the required minimum.</i>`;
        }
        
        await bot.editMessageText(
            message,
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[
                        { 
                            text: "🔄 Update Verification", 
                            callback_data: this.generateCallbackData('reverify') 
                        }
                    ]]
                }
            }
        );
    }
    
    async handleFailedVerification(bot, query, result) {
        const chatId = query.message.chat.id;
        const sessionId = query.data.split(':')[2];
        
        let message = "❌ <b>Verification Failed</b>\n\n";
        
        if (result.reason === 'Session expired') {
            message += "Your verification session has expired. Please start a new verification.";
            
            await bot.editMessageText(
                message,
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[
                            { 
                                text: "🔄 Start New Verification", 
                                callback_data: this.generateCallbackData('reverify') 
                            }
                        ]]
                    }
                }
            );
        } else if (result.reason === 'Verification transfer not detected yet') {
            // Check if there's a partial balance
            if (result.partialBalance > 0) {
                message += `We detected SOL in the verification address but no token transfer yet.\n\n`;
                message += `Please make sure you're sending <b>${this.TOKEN_SYMBOL}</b> tokens, not SOL.`;
            } else {
                message += "No verification transfer detected yet. Please make sure you've sent the tokens and try again in a moment.";
            }
            
            await bot.editMessageText(
                message,
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[
                            this.createVerificationCheckButton(sessionId)
                        ]]
                    }
                }
            );
        } else if (result.reason === 'Insufficient token balance') {
            message += `Your wallet was verified, but you don't have enough tokens.\n\n`;
            message += `Current balance: ${result.tokenBalance} ${this.TOKEN_SYMBOL}\n`;
            message += `Required balance: ${this.MIN_TOKEN_THRESHOLD} ${this.TOKEN_SYMBOL}\n\n`;
            message += `Please add more tokens to your wallet and try again.`;
            
            await bot.editMessageText(
                message,
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[
                            this.createVerificationCheckButton(sessionId)
                        ]]
                    }
                }
            );
        } else {
            message += `Error: ${result.reason}\n\nPlease try again later.`;
            
            await bot.editMessageText(
                message,
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[
                            this.createVerificationCheckButton(sessionId)
                        ]]
                    }
                }
            );
        }
    }
}

module.exports = TokenVerifyHandler;