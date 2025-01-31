const BaseAdminHandler = require('../baseAdminHandler');
const UserService = require('../../../../database/services/userService');
const logger = require('../../../../utils/logger');

class GetUserHandler extends BaseAdminHandler {
    constructor(accessControl, bot) {
        super(accessControl, bot);
    }

    normalizeUsername(username) {
        // Remove @ if present and convert to lowercase
        return username.replace('@', '').toLowerCase();
    }

    async handle(msg, args) {
        const chatId = String(msg.chat.id);
        const userId = msg.from.id;

        try {
            // Check if the user is an admin
            if (!await this.checkAdmin(userId)) {
                await this.bot.sendMessage(chatId, "❌ You are not authorized to use this command.");
                return;
            }

            // Validate arguments
            if (args.length < 1) {
                await this.bot.sendMessage(
                    chatId,
                    "Usage: /getuser <username>"
                );
                return;
            }

            const username = this.normalizeUsername(args[0]);

            // Get detailed user information
            const user = await UserService.getUser(username);
            if (!user) {
                await this.bot.sendMessage(
                    chatId,
                    `❌ User ${args[0]} not found.`
                );
                return;
            }

            // Format the user information into a readable message
            const message = this.formatUserInfo(user);

            await this.bot.sendMessage(
                chatId,
                message,
                { parse_mode: 'Markdown' }
            );

        } catch (error) {
            logger.error('Error in /getuser command:', error);
            await this.bot.sendMessage(
                chatId,
                "❌ An error occurred while fetching user information. Please try again."
            );
        }
    }

    formatUserInfo(user) {
        // Format date in a readable way
        const formatDate = (date) => {
            return new Date(date).toLocaleString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        };

        return `*User Information for ${user.username}*\n\n` +
               `🆔 User ID: \`${user.userId}\`\n` +
               `💬 Chat ID: \`${user.chatId}\`\n` +
               `🔗 Referral Link: \`${user.referralLink}\`\n` +
               `💰 Referral Wallet: \`${user.referralWallet || 'Not set'}\`\n\n` +
               `*Rewards Information*\n` +
               `📊 Unclaimed Rewards: ${user.unclaimedRewards} SOL\n` +
               `✅ Claimed Rewards: ${user.claimedRewards} SOL\n` +
               `📈 Total Rewards: ${user.totalRewards} SOL\n\n` +
               `*Referral Statistics*\n` +
               `👆 Referral Clicks: ${user.referralClicks}\n` +
               `👥 Referral Conversions: ${user.referralConversions}\n` +
               `🔄 Referred By: ${user.referredBy || 'None'}\n` +
               `👥 Referred Users: ${user.referredUsers?.length ? user.referredUsers.join(', ') : 'None'}\n\n` +
               `📅 Last Updated: ${formatDate(user.lastUpdated)}`;
    }
}

module.exports = GetUserHandler;