const logger = require('../../utils/logger');
const SolanaPaymentHandler = require('../../solanaPaymentHandler/solanaPaymentHandler');
const { updatePaymentAddressStatus } = require('../../database/database');

class GroupSubscriptionHandler {
    constructor(accessControl, heliusUrl) {
        this.accessControl = accessControl;
        this.paymentHandler = new SolanaPaymentHandler(heliusUrl);
    }

    async handleCommand(bot, msg) {
        const chatId = msg.chat.id;
        const messageThreadId = msg.message_thread_id;

        try {
            // Vérifier si on est dans un groupe
            const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
            if (!isGroup) {
                await bot.sendMessage(
                    chatId, 
                    "⚠️ This command must be used in a group.\n\n" +
                    "Please:\n" +
                    "1. Add the bot to your group\n" +
                    "2. Make sure the bot is admin\n" +
                    "3. Use /subscribe_group command in the group"
                );
                return;
            }

            // Vérifier si le groupe a déjà un abonnement actif
            const subscription = await this.accessControl.getGroupSubscription(chatId.toString());
            
            if (subscription?.active && subscription.expiresAt > new Date()) {
                // Afficher les détails de l'abonnement actif
                const daysLeft = Math.ceil((new Date(subscription.expiresAt) - new Date()) / (1000 * 60 * 60 * 24));
                
                let message = "📊 Group Subscription Status\n\n";
                message += `Group: ${msg.chat.title}\n`;
                message += `📅 Valid until: ${new Date(subscription.expiresAt).toLocaleString()}\n`;
                message += `⚡ Days remaining: ${daysLeft}\n`;
                message += `🕒 Subscribed since: ${new Date(subscription.startDate).toLocaleString()}\n\n`;
                message += "💳 Payment History:\n";

                // Trier l'historique par date décroissante
                const sortedPayments = [...subscription.paymentHistory].sort((a, b) => 
                    new Date(b.paymentDate) - new Date(a.paymentDate)
                );

                for (const payment of sortedPayments) {
                    const date = new Date(payment.paymentDate).toLocaleDateString();
                    message += `• ${date}: ${payment.duration} (ID: ${payment.paymentId}`;
                    message += `, by @${payment.paidByUsername}`;
                    
                    if (payment.transactionHash) {
                        const hash = payment.transactionHash;
                        const shortHash = `${hash.slice(0, 3)}...${hash.slice(-3)}`;
                        message += `, <a href="https://solscan.io/tx/${hash}">tx: ${shortHash}</a>`;
                    }
                    
                    message += ")\n";
                }

                message += `\n${'─'.repeat(30)}\n`;

                // Si l'abonnement expire bientôt (moins de 7 jours), ajouter un bouton pour renouveler
                const opts = {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true
                };

                if (daysLeft <= 7) {
                    opts.reply_markup = {
                        inline_keyboard: [
                            [{ text: "🔄 Renew Subscription", callback_data: "sub_group_new" }]
                        ]
                    };
                }

                await bot.sendMessage(chatId, message, opts);
                return;
            }

            // Si pas d'abonnement actif, vérifier si l'utilisateur est admin du groupe
            const chatMember = await bot.getChatMember(chatId, msg.from.id);
            const isAdmin = ['creator', 'administrator'].includes(chatMember.status);
            
            if (!isAdmin) {
                await bot.sendMessage(
                    chatId,
                    "❌ Only group administrators can subscribe the group."
                );
                return;
            }

            // Vérifier les droits du bot
            try {
                const botInfo = await bot.getMe();
                const botMember = await bot.getChatMember(chatId, botInfo.id);
                if (!botMember.can_delete_messages || !botMember.can_restrict_members) {
                    await bot.sendMessage(
                        chatId,
                        "⚠️ The bot needs administrator rights to function properly in this group.\n" +
                        "Please make the bot admin and try again."
                    );
                    return;
                }
            } catch (error) {
                logger.error('Error checking bot permissions:', error);
                await bot.sendMessage(
                    chatId,
                    "⚠️ Failed to verify bot permissions. Please ensure the bot is an administrator in this group and try again."
                );
                return;
            }

            // Si toutes les vérifications sont ok, créer la session de paiement
            const adminInfo = {
                id: msg.from.id,
                username: msg.from.username
            };

            const session = await this.paymentHandler.createGroupPaymentSession(
                chatId.toString(),
                msg.chat.title,
                adminInfo
            );

            const message =
                `💳 <b>Group Subscription Payment</b>\n\n` +
                `Group: ${msg.chat.title}\n` +
                `Amount: ${session.amount} SOL\n` +
                `Duration: 1 month\n\n` +
                `Please send exactly this amount to:\n<code>${session.paymentAddress}</code>\n\n` +
                `Then click "Check Payment" once done.\n\n` +
                `Session expires: ${session.expires.toLocaleString()}\n\n` +
                `If you're encountering issues with the payment system, please DM @rengon0x`;

            const keyboard = {
                inline_keyboard: [
                    [{
                        text: 'Check Payment',
                        callback_data: `check_group_${session.sessionId}`
                    }]
                ]
            };

            await bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
                reply_markup: keyboard
            });

        } catch (error) {
            logger.error('Error in /subscribe_group handleCommand:', error);
            await bot.sendMessage(
                chatId,
                'An error occurred while processing your request. Please try again later.'
            );
        }
    }

    async handleCallback(bot, query) {
        const chatId = query.message.chat.id;
        const callbackData = query.data;

        try {
            if (callbackData.startsWith('check_group_')) {
                const sessionId = callbackData.slice('check_group_'.length);
                const result = await this.paymentHandler.checkGroupPayment(sessionId);

                if (result.success) {
                    if (result.alreadyPaid) {
                        await bot.sendMessage(chatId, "✅ Payment was already confirmed. Group subscription is active!");
                    } else {
                        await bot.sendMessage(chatId, "✅ Payment confirmed! Activating group subscription...");

                        await updatePaymentAddressStatus(sessionId, 'completed');

                        let transferResult;
                        try {
                            transferResult = await this.paymentHandler.transferFunds(sessionId);
                            logger.debug('Group transfer result:', transferResult);
                        } catch (err) {
                            logger.error(`Error transferring group funds for session ${sessionId}:`, err);
                            transferResult = {};
                        }

                        const sessionData = this.paymentHandler.getPaymentSession(sessionId);
                        const paymentId = `group_payment_${Date.now()}`;

                        // Ajouter l'info de l'admin qui a complété le paiement
                        const payerInfo = {
                            id: query.from.id,
                            username: query.from.username
                        };

                        await this.accessControl.createGroupSubscription(
                            sessionData.groupId,
                            sessionData.groupName,
                            '1month',
                            payerInfo,
                            {
                                paymentId,
                                status: 'completed',
                                transactionHash: result.transactionHash,
                                transferHash: transferResult?.signature
                            }
                        );

                        const subscription = await this.accessControl.getGroupSubscription(sessionData.groupId);

                        let statusMessage = "🎉 Group subscription is now active!\n\n";
                        statusMessage += `Group: ${sessionData.groupName}\n`;
                        statusMessage += `Expires at: ${subscription.expiresAt.toLocaleString()}\n\n`;
                        statusMessage += "💳 Payment Details:\n";
                        statusMessage += `• Amount: 2.0 SOL\n`;
                        
                        if (result.transactionHash) {
                            const hash = result.transactionHash;
                            const shortHash = `${hash.slice(0, 3)}...${hash.slice(-3)}`;
                            statusMessage += `• <a href="https://solscan.io/tx/${hash}">Transaction: ${shortHash}</a>\n`;
                        }

                        statusMessage += `\nPaid by: @${payerInfo.username}`;

                        await bot.sendMessage(chatId, statusMessage, {
                            parse_mode: 'HTML',
                            disable_web_page_preview: true
                        });
                    }
                } else {
                    if (result.reason === 'Session expired.') {
                        await bot.sendMessage(chatId, "❌ The payment session has expired.");
                    } else if (result.reason === 'Payment not detected yet') {
                        const partialBalance = result.partialBalance ?? 0;
                        const sessionData = this.paymentHandler.getPaymentSession(sessionId);
                        const shortfall = (sessionData.amount - partialBalance).toFixed(3);

                        if (partialBalance > 0) {
                            await bot.sendMessage(
                                chatId,
                                `🚫 You sent ${partialBalance} SOL, but you need ${sessionData.amount} SOL.\n` +
                                `You are short by ${shortfall} SOL. Please send the remaining amount.`
                            );
                        } else {
                            await bot.sendMessage(
                                chatId,
                                "🚫 Payment not detected yet. Please try again in a moment."
                            );
                        }
                    } else {
                        await bot.sendMessage(chatId, `⚠️ Error: ${result.reason}`);
                    }
                }

                await bot.answerCallbackQuery(query.id);
            }
        } catch (error) {
            logger.error('Error in group subscription callback:', error);
            await bot.answerCallbackQuery(query.id, { text: "An error occurred", show_alert: true });
        }
    }
}

module.exports = GroupSubscriptionHandler;