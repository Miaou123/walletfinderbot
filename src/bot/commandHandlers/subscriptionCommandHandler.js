const logger = require('../../utils/logger');
const { UserService, SubscriptionService } = require('../../database');

class SubscriptionCommandHandler {
    constructor(accessControl, paymentHandler) {
        this.accessControl = accessControl;
        this.paymentHandler = paymentHandler;
    }

    generateCallbackData(action, params = {}) {
        let callbackData = `sub:${action}`;
        if (params.sessionId) {
            callbackData += `:${params.sessionId}`;
        }
        return callbackData;
    }

    async formatPaymentMessage(session, referrerUsername) {
        let message = `💳 <b>Payment Details</b>\n\n`;
        
        if (session.referralLinkUsed) {
            message += `Amount: ${session.finalAmount} SOL (10% referral discount applied)\n`;
        } else {
            message += `Amount: ${session.finalAmount} SOL\n`;
        }
        
        message += `Duration: 1 month\n\n`;
    
        if (referrerUsername) {
            message += `🔗 Referred by: @${referrerUsername}\n\n`;
        }
    
        if (!session.paymentAddress) {
            logger.error('Payment address is undefined in session:', session);
            message += `⚠️ Error: Payment address is not available.\n`;
        } else {
            message += `Please send exactly this amount in SOL to:\n<code>${session.paymentAddress}</code>\n\n`;
        }
    
        message += `Then click "Check Payment".\n\n`;
    
        return message;
    }

    createPaymentCheckButton(sessionId) {
        return {
            text: 'Check Payment',
            callback_data: this.generateCallbackData('check', { sessionId })
        };
    }

    createExtendButton() {
        return {
            text: "🔄 Extend Subscription",
            callback_data: this.generateCallbackData('extend')
        };
    }

    async handleCommand(bot, msg, args) {
        const chatId = msg.chat.id;
        const username = (msg.from.username || '').toLowerCase().replace(/^@/, '');
    
        try {
            const subscription = await this.accessControl.subscriptionService.getSubscription(String(chatId));

            const user = await UserService.getUserByChatId(String(chatId));
            let referrerUsername = null;

            let referralLink = null;
            if (user && user.referredBy) {
                referrerUsername = await UserService.getUsernameFromChatId(user.referredBy);
                referralLink = await UserService.getReferralLink(user.referredBy);
            }
    
            if (subscription?.active && subscription.expiresAt > new Date()) {
                const daysLeft = Math.ceil((new Date(subscription.expiresAt) - new Date()) / (1000 * 60 * 60 * 24));
                let message = this.formatSubscriptionStatus(subscription, daysLeft, referrerUsername);
    
                const opts = {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                    reply_markup: {
                        inline_keyboard: [
                            [this.createExtendButton()]
                        ]
                    }
                };
    
                await bot.sendMessage(chatId, message, opts);
                return;
            }
    
            const session = await this.paymentHandler.createPaymentSession(
                String(chatId),
                username,
                '1month',
                referralLink
            );

            const message = await this.formatPaymentMessage(session, referrerUsername);
    
            await bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [this.createPaymentCheckButton(session.sessionId)]
                    ]
                }
            });
    
        } catch (error) {
            logger.error('Error in /subscribe handleCommand:', error);
            await bot.sendMessage(chatId,
                'An error occurred while processing your request. Please try again later.'
            );
        }
    }

    formatSubscriptionStatus(subscription, daysLeft, referrerUsername) {
        let message = 
            `📊 Subscription Status\n\n` +
            `👤 Username: @${subscription.username}\n` +
            `⚡ Days remaining: ${daysLeft}\n`;
    
        if (referrerUsername) {
            message += `🔗 Referred by: @${referrerUsername}\n`;
        }
    
        message += `\n💳 Payment History:\n`;
    
        const sortedPayments = [...subscription.paymentHistory].sort((a, b) => 
            new Date(b.paymentDate) - new Date(a.paymentDate)
        );
    
        for (const payment of sortedPayments) {
            const date = new Date(payment.paymentDate).toLocaleDateString();
            message += `• ${date}: (ID: ${payment.paymentId}`;
            
            if (payment.transactionHash) {
                const hash = payment.transactionHash;
                const shortHash = `${hash.slice(0, 3)}...${hash.slice(-3)}`;
                message += `, <a href="https://solscan.io/tx/${hash}">tx: ${shortHash}</a>`;
            }
            
            message += ")\n";
        }
    
        message += `\n${'─'.repeat(30)}\n`;
        return message;
    }

    async handlePaymentProcess(bot, query) {
        const chatId = query.message.chat.id;
        const username = (query.from.username || '').toLowerCase().replace(/^@/, '');
    
        // Récupérer les informations de parrainage
        const user = await UserService.getUserByChatId(String(chatId));
        let referrerUsername = null;
        let referralLink = null;
        if (user && user.referredBy) {
            referrerUsername = await UserService.getUsernameFromChatId(user.referredBy);
            referralLink = await UserService.getReferralLink(user.referredBy);
        }
    
        const session = await this.paymentHandler.createPaymentSession(
            String(chatId),
            username,
            '1month',
            referralLink
        );
    
        const message = await this.formatPaymentMessage(session, referrerUsername);

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [this.createPaymentCheckButton(session.sessionId)]
                ]
            }
        });
    }

    async handlePaymentCheck(bot, query, sessionId) {
        const chatId = query.message.chat.id;
        const username = (query.from.username || '').toLowerCase().replace(/^@/, '');
        const result = await this.paymentHandler.checkPayment(sessionId);

        if (result.success) {
            if (result.alreadyPaid) {
                await bot.sendMessage(chatId, "✅ Payment was already confirmed. Subscription is active!");
            } else {
                await this.processSuccessfulPayment(bot, chatId, sessionId, username, result);
            }
        } else {
            await this.handleFailedPayment(bot, chatId, sessionId, result);
        }
    }

    async processSuccessfulPayment(bot, chatId, sessionId, username, result) {
        await bot.sendMessage(chatId, "✅ Payment confirmed! Your subscription is being activated...");

        logger.debug(`Calling updatePaymentAddressStatus with sessionId: ${sessionId} and status: 'completed'`);

        await this.accessControl.paymentService.updatePaymentAddressStatus(sessionId, 'completed');
    
        let transferResult = {};
        try {
            transferResult = await this.paymentHandler.transferFunds(sessionId);
            logger.debug('Transfer result:', transferResult);
        } catch (err) {
            logger.error(`Error transferring funds for session ${sessionId}:`, err);
        }
    
        const sessionData = this.paymentHandler.getPaymentSession(sessionId);

        logger.debug('Session data for rewards calculation:', {
            finalAmount: sessionData.finalAmount,
            baseAmount: sessionData.baseAmount
        });

        const paymentId = `sol_payment_${Date.now()}`;
        const transactionHashes = {
            transactionHash: result.transactionHash,
            transferHash: transferResult?.signature
        };
    
        await this.accessControl.subscriptionService.createOrUpdateSubscription(
            String(chatId), 
            username, 
            paymentId,
            sessionData.finalAmount,
            transactionHashes
        );
    
        // Ajout de la logique de récompense du parrain
        const user = await UserService.getUserByChatId(String(chatId));
        if (user && user.referredBy) {
            // S'assurer que le montant est un nombre valide
            const rewardAmount = Number(sessionData.baseAmount);
            if (!isNaN(rewardAmount)) {
                logger.debug('Updating referrer rewards with amount:', rewardAmount);
                await this.accessControl.subscriptionService.updateReferrerRewards(user.referredBy, rewardAmount);
                await UserService.recordReferralConversion(String(chatId));
            } else {
                logger.error('Invalid amount for referral reward:', sessionData.finalAmount);
            }
        }
    
    
        const subscription = await this.accessControl.subscriptionService.getSubscription(String(chatId));
        if (subscription) {
            await this.sendSuccessMessage(bot, chatId, subscription);
        }
    }

    async handleFailedPayment(bot, chatId, sessionId, result) {
        if (result.reason === 'Session expired.') {
            await bot.sendMessage(chatId, "❌ The payment session has expired.");
        } else if (result.reason === 'Payment not detected yet') {
            const partialBalance = result.partialBalance ?? 0;
            const sessionData = this.paymentHandler.getPaymentSession(sessionId);
            const shortfall = (sessionData.finalAmount - partialBalance).toFixed(3);

            if (partialBalance > 0) {
                await bot.sendMessage(chatId,
                    `🚫 You sent ${partialBalance} SOL, but you need ${sessionData.finalAmount} SOL.\n` +
                    `You are short by ${shortfall} SOL. Please send the remaining amount.`
                );
            } else {
                await bot.sendMessage(chatId,
                    "🚫 Payment not detected yet. Please try again in a moment."
                );
            }
        } else {
            await bot.sendMessage(chatId, `⚠️ Error: ${result.reason}, please try again in a moment`);
        }
    }

    async sendSuccessMessage(bot, chatId, subscription) {
        let historyMessage = "🎉 Your subscription is now active!\n";
        historyMessage += `Expires at: ${subscription.expiresAt.toLocaleString()}\n\n`;
        historyMessage += "💳 Payment History:\n";

        const sortedHistory = [...subscription.paymentHistory].sort((a, b) => 
            new Date(a.paymentDate) - new Date(b.paymentDate)
        );

        for (const payment of sortedHistory) {
            const date = new Date(payment.paymentDate).toLocaleDateString();
            historyMessage += `• ${date}: ${payment.duration} (ID: ${payment.paymentId}`;

            if (payment.transactionHash) {
                const hash = payment.transactionHash;
                const shortHash = `${hash.slice(0, 3)}...${hash.slice(-3)}`;
                historyMessage += `, <a href="https://solscan.io/tx/${hash}">tx: ${shortHash}</a>`;
            }

            historyMessage += ")\n";
        }

        historyMessage += "\n💡 You can check your subscription status anytime using /subscribe";

        await bot.sendMessage(chatId, historyMessage, {
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
    }

    async handleCallback(bot, query) {
        try {
            const [category, action, sessionId] = query.data.split(':');
            
            switch (action) {
                case 'extend':
                case 'subscribe':
                    await this.handlePaymentProcess(bot, query);
                    break;
                case 'check':
                    await this.handlePaymentCheck(bot, query, sessionId);
                    break;
                default:
                    throw new Error(`Unknown subscription action: ${action}`);
            }

            await bot.answerCallbackQuery(query.id);
        } catch (error) {
            logger.error('Error in subscription callback:', error);
            await bot.answerCallbackQuery(query.id, { text: "An error occurred", show_alert: true });
        }
    }
}

module.exports = SubscriptionCommandHandler;