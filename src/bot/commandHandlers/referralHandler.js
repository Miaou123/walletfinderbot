const logger = require('../../utils/logger');
const { UserService } = require('../../database'); 
const solanaAddressRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

class ReferralHandler {
  constructor(stateManager, claimSystem) {
    this.stateManager = stateManager;
    this.claimSystem = claimSystem;
  }

  async formatReferralMessage(userData, referralLink) {
    // Formatage des nombres avec 2 décimales
    const formatSOL = (number) => parseFloat(number || 0).toFixed(2);

    const totalRewards = formatSOL(userData.totalRewards);
    const unclaimedRewards = formatSOL(userData.unclaimedRewards);
    const claimedRewards = formatSOL(userData.claimedRewards);
    const referralConversions = userData.referralConversions || 0;

    let message = "💫 <b>Noesis Referral Program - Earn While You Share!</b>\n\n";

    message += "💎 <b>How It Works</b>\n";
    message += "• Share your unique referral link with friends\n";
    message += "• They get 10% OFF their subscription\n";
    message += "• You earn 10% of their subscription fee\n";
    message += "• You can claim you rewards instantly\n";
    message += "• No limit on the number of referrals!\n\n";
    
    message += "📊 <b>Your Statistics</b>\n";
    message += `• Users referred: <code>${referralConversions}</code> (active subscribers)\n`;
    message += `• Total rewards earned: <code>${totalRewards}</code> SOL\n`;
    message += `• Unclaimed rewards: <code>${unclaimedRewards}</code> SOL\n`;
    message += `• Claimed rewards: <code>${claimedRewards}</code> SOL\n\n`;

    if (!userData.referralWallet) {
        message += "Your Referral Link:\nPlease set up your deposit address to view your referral link.\n";
    } else {
        message += `🔗 <b>Your Referral Link:</b>\n<code>${referralLink}</code>\n\n`;
        const fullAddr = userData.referralWallet;
        message += `💰 Rewards Wallet: <code>${fullAddr}</code>`; 
    }

    const inlineKeyboard = [];
    
    // Bouton pour gérer l'adresse
    inlineKeyboard.push([
        userData.referralWallet
            ? { text: "Change Address", callback_data: "referral:changeAddress" }
            : { text: "Set Address", callback_data: "referral:setAddress" }
    ]);

    // Bouton Claim si des récompenses sont disponibles
    if (userData.referralWallet && parseFloat(unclaimedRewards) > 0) {
        inlineKeyboard.push([
            { text: "🎁 Claim Rewards", callback_data: "referral:claim" }
        ]);
    }

    return { message, inlineKeyboard };
  }

  async handleCommand(bot, msg) {
    const userId = msg.from.id.toString();
    const chatId = msg.chat.id.toString();
    const username = (msg.from.username || '').toLowerCase();
    
    try {
        let referralDoc = await UserService.getUserById(userId);

        if (!referralDoc) {
            logger.info(`No user found for userId: ${userId}. Creating new user.`);
            referralDoc = await UserService.createOrUpdateUser(msg);
        }

        // Utiliser userId au lieu de chatId
        const referralLink = referralDoc?.referralLink 
            || await UserService.saveReferralLink(msg);

        const { message, inlineKeyboard } = await this.formatReferralMessage(referralDoc, referralLink);

        await bot.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: inlineKeyboard }
        });

    } catch (err) {
        logger.error(`Error in /referral handleCommand for userId ${userId}:`, err);
        await bot.sendMessage(chatId, 
            "An error occurred while processing your referral request. Please try again later."
        );
    }
  }

  async handleCallback(bot, query) {
    const userId = query.from.id.toString();
    const chatId = query.message.chat.id;
    const data = query.data;

    try {
        switch (data) {
            case "referral:setAddress":
            case "referral:changeAddress":
                await this.handleAddressSetup(bot, chatId, userId);
                break;

            case "referral:claim":
                await this.handleClaimRequest(bot, userId, chatId, query.message.message_id);
                break;

            case "referral:confirmClaim":
                await this.handleClaimConfirmation(bot, userId, chatId, query.message.message_id);
                break;

            case "referral:cancelClaim":
                await this.handleClaimCancellation(bot, userId, chatId, query.message.message_id);
                break;
        }

        await bot.answerCallbackQuery(query.id);
    } catch (err) {
        logger.error(`Error in referral callback for userId ${userId}:`, err);
        await bot.answerCallbackQuery(query.id, { 
            text: "An error occurred", 
            show_alert: true 
        });
    }
  }

  async handleAddressSetup(bot, chatId, userId) {
    this.stateManager.setUserState(userId, {
        context: 'referral',
        step: 'WAITING_ADDRESS'
    });

    await bot.sendMessage(chatId,
        "Enter your destination wallet for referral rewards.\n\n" +
        "(Please reply with a valid Solana address.)"
    );
  }

  async handleClaimRequest(bot, userId, chatId, messageId) {
    const eligibility = await this.claimSystem.verifyClaimEligibility(userId);
    
    if (!eligibility.eligible) {
        await bot.answerCallbackQuery(query.id, {
            text: eligibility.reason,
            show_alert: true
        });
        return;
    }

    const confirmMessage = 
        `💰 <b>Claim Rewards</b>\n\n` +
        `Amount to claim: <code>${eligibility.amount.toFixed(2)}</code> SOL\n\n` +
        `Destination: <code>${eligibility.walletAddress}</code>\n\n` +
        `Click confirm to receive your rewards.`;

    await bot.editMessageText(confirmMessage, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [[
                { text: "✅ Confirm", callback_data: "referral:confirmClaim" },
                { text: "❌ Cancel", callback_data: "referral:cancelClaim" }
            ]]
        }
    });
  }

  async handleClaimConfirmation(bot, userId, chatId, messageId) {
    const result = await this.claimSystem.processClaim(userId);
    
    if (result.success) {
        const successMessage = 
            `✅ <b>Rewards Claimed Successfully!</b>\n\n` +
            `Amount: <code>${result.amount.toFixed(2)}</code> SOL\n` +
            `Transaction: <a href="https://solscan.io/tx/${result.transactionSignature}">View on Solscan</a>`;

        // Rafraîchir le message principal avec les stats mises à jour
        const user = await UserService.getUserById(userId);
        const referralLink = await UserService.getReferralLink({ from: { id: userId } });
        const { message, inlineKeyboard } = await this.formatReferralMessage(user, referralLink);

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: inlineKeyboard }
        });

        await bot.sendMessage(chatId, successMessage, {
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
    } else {
        await bot.answerCallbackQuery(query.id, {
            text: `Claim failed: ${result.reason}`,
            show_alert: true
        });
    }
  }

  async handleClaimCancellation(bot, userId, chatId, messageId) {
    const user = await UserService.getUserById(userId);
    const referralLink = await UserService.getReferralLink({ from: { id: userId } });
    const { message, inlineKeyboard } = await this.formatReferralMessage(user, referralLink);

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: inlineKeyboard }
    });
  }

  async handleAddressInput(bot, msg) {
    const userId = msg.from.id.toString();
    const chatId = msg.chat.id.toString();
    const text = msg.text.trim();

    logger.debug(`Attempting to set referral wallet for user ${userId}`);

    if (!solanaAddressRegex.test(text)) {
        await bot.sendMessage(chatId, 
            "That doesn't look like a valid Solana address. Please try again."
        );
        return;
    }

    try {
        logger.debug(`Setting referral wallet ${text} for user ${userId}`);
        await UserService.setReferralWallet(userId, text);
        
        logger.debug(`Getting updated user data for ${userId}`);
        const userData = await UserService.getUserById(userId);
        logger.debug('Updated user data:', userData);
        
        const referralLink = userData?.referralLink || 
            await UserService.saveReferralLink(msg);

        const { message, inlineKeyboard } = await this.formatReferralMessage(userData, referralLink);
        this.stateManager.deleteUserState(userId);

        await bot.sendMessage(chatId, message, { 
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: inlineKeyboard }
        });
    } catch (err) {
        logger.error(`Error setting referral wallet for userId ${userId}:`, err);
        await bot.sendMessage(chatId, 
            "An error occurred while saving your wallet. Please try again later."
        );
    }
  }
}

module.exports = ReferralHandler;

