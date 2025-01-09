const logger = require('../../utils/logger');
const { updatePaymentAddressStatus } = require('../../database/database');

class SubscriptionCommandHandler {
    constructor(accessControl, paymentHandler) {
        this.accessControl = accessControl;
        this.paymentHandler = paymentHandler; 
    }

    async handleCommand(bot, msg, args) {
        const chatId = msg.chat.id;
        const username = (msg.from.username || '').toLowerCase().replace(/^@/, '');
    
        try {
            const subscription = await this.accessControl.getSubscription(username);
    
            if (subscription?.active && subscription.expiresAt > new Date()) {
                const daysLeft = Math.ceil((new Date(subscription.expiresAt) - new Date()) / (1000 * 60 * 60 * 24));
    
                let message = 
                    `📊 Subscription Status\n\n` +
                    `👤 Username: @${subscription.username}\n` +
                    `📅 Valid until: ${new Date(subscription.expiresAt).toLocaleString()}\n` +
                    `⚡ Days remaining: ${daysLeft}\n` +
                    `🕒 Member since: ${new Date(subscription.startDate).toLocaleString()}\n\n` +
                    `💳 Payment History:\n`;
    
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
    
                const opts = {
                  parse_mode: 'HTML',
                  disable_web_page_preview: true,
                  reply_markup: {
                      inline_keyboard: [
                          [{ text: "🔄 Extend Subscription", callback_data: 'sub_extend' }]
                      ]
                  }
                };
    
                await bot.sendMessage(chatId, message, opts);
                return;
            }
    
            const keyboard = {
                inline_keyboard: [
                    [{ text: "🥉 Subscribe (0.5 SOL/month)", callback_data: "sub_subscribe" }]
                ]
            };
    
            await bot.sendMessage(
                chatId,
                "🔰 Subscription\nClick to subscribe:",
                {
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                }
            );
    
        } catch (error) {
            logger.error('Error in /subscribe handleCommand:', error);
            await bot.sendMessage(chatId,
                'An error occurred while processing your request. Please try again later.'
            );
        }
    }

    async handleCallback(bot, query) {
        const chatId = query.message.chat.id;
        const callbackData = query.data;
        const username = (query.from.username || '').toLowerCase().replace(/^@/, '');
    
        try {
            if (callbackData === 'sub_extend' || callbackData === 'sub_subscribe') {
                const session = await this.paymentHandler.createPaymentSession(username);
    
                const message =
                    `💳 <b>Payment Details</b>\n\n` +
                    `Amount: 0.5 SOL\n` +
                    `Duration: 1 month\n\n` +
                    `Please send exactly this amount to:\n<code>${session.paymentAddress}</code>\n\n` +
                    `Then click "Check Payment" once done.\n\n` +
                    `Session expires in 30 minutes.\n\n` +
                    `If you're encountering issues, please DM @rengon0x`;
    
                const keyboard = {
                    inline_keyboard: [
                        [{
                            text: 'Check Payment',
                            callback_data: `check_${session.sessionId}`
                        }]
                    ]
                };
    
                await bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });
    
                await bot.answerCallbackQuery(query.id);
                return;
            }

            if (callbackData.startsWith('check_')) {
                const sessionId = callbackData.slice('check_'.length);
                const result = await this.paymentHandler.checkPayment(sessionId);

                if (result.success) {
                    if (result.alreadyPaid) {
                        await bot.sendMessage(chatId, "✅ Payment was already confirmed. Subscription is active!");
                    } else {
                        await bot.sendMessage(chatId, "✅ Payment confirmed! Your subscription is being activated...");

                        await updatePaymentAddressStatus(sessionId, 'completed');

                        let transferResult;
                        try {
                            transferResult = await this.paymentHandler.transferFunds(sessionId);
                            logger.debug('Transfer result:', transferResult);
                        } catch (err) {
                            logger.error(`Error transferring funds for session ${sessionId}:`, err);
                            transferResult = {};
                        }

                        const sessionData = this.paymentHandler.getPaymentSession(sessionId);
                        const paymentId = `sol_payment_${Date.now()}`;

                        await this.accessControl.createSubscription(username, sessionData.duration, {
                            paymentId,
                            status: 'completed',
                            transactionHash: result.transactionHash,
                            transferHash: transferResult?.signature
                        });

                        const subscription = await this.accessControl.getSubscription(username);

                        if (subscription) {
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
                    }
                } else {
                    if (result.reason === 'Session expired.') {
                        await bot.sendMessage(chatId, "❌ The payment session has expired.");
                    } else if (result.reason === 'Payment not detected yet') {
                        const partialBalance = result.partialBalance ?? 0;
                        const sessionData = this.paymentHandler.getPaymentSession(sessionId);
                        const shortfall = (sessionData.amount - partialBalance).toFixed(3);

                        if (partialBalance > 0) {
                            await bot.sendMessage(chatId,
                                `🚫 You sent ${partialBalance} SOL, but you need ${sessionData.amount} SOL.\n` +
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

                await bot.answerCallbackQuery(query.id);
            }
        } catch (error) {
            logger.error('Error in subscription callback:', error);
            await bot.answerCallbackQuery(query.id, { text: "An error occurred", show_alert: true });
        }
    }
}

module.exports = SubscriptionCommandHandler;