const logger = require('../../utils/logger');
const { UserService } = require('../../database'); 

class GroupSubscriptionHandler {
    constructor(accessControl, paymentHandler) {
        this.accessControl = accessControl;
        this.paymentHandler = paymentHandler;
    }

    generateCallbackData(action, params = {}) {
        let callbackData = `group:${action}`;
        if (params.sessionId) {
            callbackData += `:${params.sessionId}`;
        }
        return callbackData;
    }

    createPaymentCheckButton(sessionId) {
        return {
            text: 'Check Payment',
            callback_data: this.generateCallbackData('check', { sessionId })
        };
    }

    createExtendButton() {
        return {
            text: "🔄 Extend Group Subscription",
            callback_data: this.generateCallbackData('extend')
        };
    }

    async handleCommand(bot, msg) {
        const chatId = String(msg.chat.id);

        try {
            if (!await this.validateGroupContext(bot, msg)) {
                return;
            }

            const subscription = await this.accessControl.subscriptionService.getGroupSubscription(chatId.toString());
            
            if (subscription?.active && subscription.expiresAt > new Date()) {
                await this.showActiveSubscription(bot, msg, subscription);
                return;
            }

            if (!await this.validateAdminRights(bot, msg)) {
                return;
            }

            await this.initiateNewSubscription(bot, msg);

        } catch (error) {
            logger.error('Error in /subscribe_group handleCommand:', error);
            await bot.sendMessage(
                chatId,
                'An error occurred while processing your request. Please try again later.'
            );
        }
    }

    async validateGroupContext(bot, msg) {
        const chatId = String(msg.chat.id);
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
            return false;
        }
        return true;
    }

    async validateAdminRights(bot, msg) {
        const chatId = String(msg.chat.id);
        const adminUserId = msg.from?.id ? String(msg.from.id) : null;
        
        if (!adminUserId) {
            logger.error("❌ ERROR: Unable to retrieve adminUserId for group subscription", { msg });
            await bot.sendMessage(msg.chat.id, "❌ Error: Could not retrieve admin details.");
            return;
        }
        
        // Vérifier si l'utilisateur est admin
        const chatMember = await bot.getChatMember(chatId, adminUserId);
        const isAdmin = ['creator', 'administrator'].includes(chatMember.status);
        
        if (!isAdmin) {
            await bot.sendMessage(chatId, "❌ Only group administrators can subscribe the group.");
            return false;
        }

        // Le reste de la validation reste identique
        try {
            const botInfo = await bot.getMe();
            const botMember = await bot.getChatMember(chatId, botInfo.id);
            if (!botMember.can_delete_messages || !botMember.can_restrict_members) {
                await bot.sendMessage(
                    chatId,
                    "⚠️ The bot needs administrator rights to function properly in this group.\n" +
                    "Please make the bot admin and try again."
                );
                return false;
            }
        } catch (error) {
            logger.error('Error checking bot permissions:', error);
            await bot.sendMessage(
                chatId,
                "⚠️ Failed to verify bot permissions. Please ensure the bot is an administrator in this group and try again."
            );
            return false;
        }
        
        return true;
    }

    async showActiveSubscription(bot, msg, subscription) {
        const chatId = String(msg.chat.id);
        const daysLeft = Math.ceil((new Date(subscription.expiresAt) - new Date()) / (1000 * 60 * 60 * 24));
        const message = this.formatSubscriptionStatus(msg.chat.title, subscription, daysLeft);

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
    }

    formatSubscriptionStatus(groupTitle, subscription, daysLeft) {
        let message = "📊 Group Subscription Status\n\n";
        message += `Group: ${groupTitle}\n`;
        message += `⚡ Days remaining: ${daysLeft}\n`;
        message += "💳 Payment History:\n";

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
        return message;
    }

    async initiateNewSubscription(bot, msg) {
        const chatId = String(msg.chat.id);
        const groupName = msg.chat.title;
        const adminUserId = msg.from?.id ? String(msg.from.id) : null;

        console.log ("admin user id is: " + adminUserId);
        const adminUsername = msg.from?.username || "unknown";
    
        if (!adminUserId) {
            logger.error("❌ ERROR: Unable to retrieve adminUserId for group subscription", { msg });
            await bot.sendMessage(chatId, "❌ Error: Could not retrieve admin details.");
            return;
        }
    
        const adminInfo = {
            userId: adminUserId,
            username: adminUsername
        };

        logger.debug("📥 createGroupPaymentSession() received:", {
            chatId,
            groupName,
            adminInfo
        });        

        const session = await this.paymentHandler.createGroupPaymentSession(
            chatId,
            groupName,
            adminInfo
        );
    
        const message = this.formatPaymentMessage(msg.chat.title, session);
        await bot.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[this.createPaymentCheckButton(session.sessionId)]]
            }
        });
    }    

    formatPaymentMessage(groupTitle, session) {
        return `💳 <b>Group Subscription Payment</b>\n\n` +
               `Group: ${groupTitle}\n` +
               `Amount: ${session.amount} SOL\n` +
               `Duration: 1 month\n\n` +
               `Please send exactly this amount in SOL to:\n<code>${session.paymentAddress}</code>\n\n` +
               `Then click "Check Payment".\n\n`
    }

    async handlePaymentProcess(bot, query) {
        const chatId = String(query.message.chat.id); 
        const adminInfo = {
            id: query.from.id.toString(),
            username: query.from.username
        };

        const session = await this.paymentHandler.createGroupPaymentSession(
            chatId.toString(),
            query.message.chat.title,
            adminInfo
        );

        const message = this.formatPaymentMessage(query.message.chat.title, session);
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
        const chatId = String(query.message.chat.id);
        const sessionData = this.paymentHandler.getPaymentSession(sessionId);

        if (!await this.validateSession(bot, query, sessionId, sessionData)) {
            return;
        }

        const result = await this.paymentHandler.checkPayment(sessionId);

        if (result.success) {
            await this.handleSuccessfulPayment(bot, query, sessionId, sessionData, result);
        } else {
            await this.handleFailedPayment(bot, chatId, sessionData, result);
        }
    }

    async validateSession(bot, query, sessionId, sessionData) {
        const chatId = String(query.message.chat.id);

        if (!sessionData) {
            logger.error(`No session found for ID: ${sessionId}`);
            await bot.sendMessage(chatId, "❌ Group payment session not found or expired. Please start a new group subscription.");
            await bot.answerCallbackQuery(query.id);
            return false;
        }

        if (sessionData.type !== 'group') {
            logger.error(`Invalid session type for ID: ${sessionId}`);
            await bot.answerCallbackQuery(query.id, { 
                text: "Invalid group session type", 
                show_alert: true 
            });
            return false;
        }

        return true;
    }

    async handleSuccessfulPayment(bot, query, sessionId, sessionData, result) {
        const chatId = String(query.message.chat.id);
        const groupName = query.message.chat.title;
    
        if (result.alreadyPaid) {
            await bot.sendMessage(chatId, "✅ Group payment was already confirmed. Group subscription is active!");
            return;
        }
    
        await bot.sendMessage(chatId, "✅ Group payment confirmed! Activating group subscription...");
        await this.accessControl.paymentService.updatePaymentAddressStatus(sessionId, 'completed');
    
        let transferResult = {};
        try {
            transferResult = await this.paymentHandler.transferFunds(sessionId);
            logger.debug('Group transfer result:', transferResult);
        } catch (err) {
            logger.error(`Error transferring group funds for session ${sessionId}:`, err);
        }
    
        const transactionHashes = {
            transactionHash: result.transactionHash,       
            transferHash: transferResult?.signature          
        };
    
        const paymentId = `group_payment_${Date.now()}`;
        
        // Créer un objet msg compatible avec ce qu'attend createOrUpdateGroupSubscription
        const msgObj = {
            chat: {
                id: chatId
            },
            from: {
                id: query.from.id,
                username: query.from.username
            }
        };

        console.log('msg obj:', msgObj);
    
        await this.accessControl.subscriptionService.createOrUpdateGroupSubscription(
            msgObj, 
            groupName, 
            paymentId, 
            transactionHashes
        );
    
        const subscription = await this.accessControl.subscriptionService.getGroupSubscription(String(chatId));
        if (subscription) {
            await this.sendSuccessMessage(bot, chatId, {
                ...sessionData,
                groupName 
            });
        }
    }

    async handleFailedPayment(bot, chatId, sessionData, result) {
        if (result.reason === 'Session expired.') {
            await bot.sendMessage(chatId, "❌ The group payment session has expired.");
        } else if (result.reason === 'Payment not detected yet') {
            const partialBalance = result.partialBalance ?? 0;
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
                    "🚫 Group payment not detected yet. Please try again in a moment."
                );
            }
        } else {
            await bot.sendMessage(chatId, `⚠️ Error: ${result.reason}`);
        }
    }

    async sendSuccessMessage(bot, chatId, sessionData) {
        const subscription = await this.accessControl.subscriptionService.getGroupSubscription(sessionData.chatId);
        let statusMessage = "🎉 Group subscription is now active!\n\n";
        statusMessage += `Group: ${sessionData.groupName}\n`;
        statusMessage += `Expires at: ${subscription.expiresAt.toLocaleString()}\n\n`;
        statusMessage += "💳 Payment History:\n";

        const sortedPayments = [...subscription.paymentHistory].sort((a, b) => 
            new Date(b.paymentDate) - new Date(a.paymentDate)
        );

        for (const payment of sortedPayments) {
            const date = new Date(payment.paymentDate).toLocaleDateString();
            statusMessage += `• ${date}: ${payment.duration} (ID: ${payment.paymentId}`;
            
            if (payment.transactionHash) {
                const hash = payment.transactionHash;
                const shortHash = `${hash.slice(0, 3)}...${hash.slice(-3)}`;
                statusMessage += `, <a href="https://solscan.io/tx/${hash}">tx: ${shortHash}</a>`;
            }
            
            statusMessage += `, Paid by: @${payment.paidByUsername})\n`;
        }

        statusMessage += "\n💡 You can check group subscription status using /subscribe_group";

        await bot.sendMessage(chatId, statusMessage, {
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
    }

    async handleCallback(bot, query) {
        try {
            const [category, action, sessionId] = query.data.split(':');
            
            switch (action) {
                case 'extend':
                    await this.handlePaymentProcess(bot, query);
                    break;
                case 'check':
                    await this.handlePaymentCheck(bot, query, sessionId);
                    break;
                default:
                    throw new Error(`Unknown group subscription action: ${action}`);
            }

            await bot.answerCallbackQuery(query.id);
        } catch (error) {
            logger.error('Error in group subscription callback:', error);
            await bot.answerCallbackQuery(query.id, { text: "An error occurred", show_alert: true });
        }
    }
}

module.exports = GroupSubscriptionHandler;