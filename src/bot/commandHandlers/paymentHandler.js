const logger = require('../../utils/logger');
const { Connection, PublicKey } = require('@solana/web3.js');
const SolanaPaymentHandler = require('../../subscriptions/SolanaPayment');
const config = require('../../utils/config');  // Ajustez le chemin selon votre structure

class SubscriptionCommandHandler {
    constructor(accessControl) {
        // Utiliser la même structure de connexion que SolanaApi
        if (!config.HELIUS_RPC_URL) {
            throw new Error('HELIUS_RPC_URL is not set. Please check your environment variables.');
        }
        
        this.paymentHandler = new SolanaPaymentHandler(config.HELIUS_RPC_URL);
        this.accessControl = accessControl;
        this.COMMAND_NAME = 'subscribe';
        this.paymentHandler.onPaymentReceived = this.handlePaymentReceived.bind(this);
    }


    async handleCommand(bot, msg, args) {
        const chatId = msg.chat.id;
        const username = msg.from.username;
        logger.info(`Starting Subscribe command for user ${username}`);

        try {
            if (!username) {
                await bot.sendMessage(chatId, "You need a Telegram username to subscribe.");
                return;
            }

            await this.showSubscriptionMenu(bot, chatId);
        } catch (error) {
            logger.error('Error in subscribe command:', error);
            throw error;
        }
    }

    async handleCallback(bot, query) {
        const chatId = query.message.chat.id;
        const username = query.from.username;
        const duration = query.data.split('_')[1];

        logger.info(`Processing subscription callback for user ${username}, duration: ${duration}`);

        try {
            const loadingMsg = await bot.sendMessage(chatId, '⏳ Creating payment session...');
            const paymentSession = await this.paymentHandler.createPaymentSession(username, duration);
            
            const message = this.formatPaymentMessage(paymentSession);
            
            await bot.deleteMessage(chatId, loadingMsg.message_id);
            await bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });
        } catch (error) {
            logger.error(`Error processing subscription callback for user ${username}:`, error);
            await bot.sendMessage(
                chatId,
                'An error occurred while creating your payment session. Please try again later.'
            );
        }
    }

    async handlePaymentReceived(paymentData) {
        try {
            // Créer l'abonnement une fois le paiement reçu
            const subscription = await this.accessControl.createSubscription(
                paymentData.username,
                'basic',
                paymentData.duration
            );

            logger.info(`Subscription created for user ${paymentData.username}`);
            
            // On pourrait envoyer une notification à l'utilisateur ici
            // si on stocke le chatId dans paymentData
        } catch (error) {
            logger.error('Error creating subscription after payment:', error);
        }
    }

    // Helper methods
    async showSubscriptionMenu(bot, chatId) {
        const keyboard = {
            inline_keyboard: [
                [{ text: '1 Month (0.5 SOL) 🥉', callback_data: 'sub_1month' }],
                [{ text: '3 Months (1.2 SOL) 🥈', callback_data: 'sub_3month' }],
                [{ text: '6 Months (2.0 SOL) 🥇', callback_data: 'sub_6month' }]
            ]
        };

        await bot.sendMessage(
            chatId,
            '🔰 <b>Subscription Options</b>\n\n' +
            'Please select your subscription duration:',
            { 
                reply_markup: keyboard,
                parse_mode: 'HTML'
            }
        );
    }

    formatPaymentMessage(paymentSession) {
        return (
            '💳 <b>Payment Details</b>\n\n' +
            `Amount: ${paymentSession.amount} SOL\n` +
            `Duration: ${paymentSession.duration}\n\n` +
            '📤 Please send exactly the specified amount to:\n' +
            `<code>${paymentSession.paymentAddress}</code>\n\n` +
            '⌛ Payment will be automatically detected\n' +
            `⚠️ Session expires: ${paymentSession.expires.toLocaleString()}`
        );
    }
}

module.exports = SubscriptionCommandHandler;