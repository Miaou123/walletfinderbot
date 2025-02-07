const BaseAdminHandler = require('../baseAdminHandler');
const logger = require('../../../../utils/logger');

class RemoveGroupSubscriptionHandler extends BaseAdminHandler {
    constructor(accessControl, bot) {
        super(accessControl, bot);
    }

    async handle(msg, args) {
        const chatId = String(msg.chat.id);
        const userId = msg.from.id;

        try {
            if (!await this.checkAdmin(userId)) {
                return;
            }

            if (args.length < 1) {
                await this.bot.sendMessage(
                    chatId,
                    "Usage: /removegroupsub <group_name>"
                );
                return;
            }

            const groupName = args[0].trim();
            
            // 🔍 Récupérer le groupe dans la base de données AVANT suppression
            const groupSubscription = await this.accessControl.subscriptionService.getGroupSubscriptionByName(groupName);
            
            if (!groupSubscription) {
                await this.bot.sendMessage(
                    chatId,
                    `❌ No group subscription found for "${groupName}"`
                );
                return;
            }

            const groupChatId = groupSubscription.chatId; // ID du groupe trouvé en DB

            // 🔥 Suppression de l'abonnement du groupe
            const result = await this.accessControl.subscriptionService.removeGroupSubscriptionByChatId(groupChatId);

            logger.info("🗑️ Deleting group subscription for:", groupChatId, "Result:", result);

            if (result.deletedCount > 0) {
                await this.bot.sendMessage(
                    chatId,
                    `✅ Group Subscription successfully removed for ${groupSubscription.groupName}\n` +
                    `Last valid until: ${new Date(groupSubscription.expiresAt).toLocaleString()}`
                );
            } else {
                await this.bot.sendMessage(
                    chatId,
                    `❌ Failed to remove group subscription for ${groupSubscription.groupName}`
                );
            }

        } catch (error) {
            logger.error('Error in removegroupsub command:', error);
            await this.bot.sendMessage(
                chatId,
                "❌ An error occurred while removing the group subscription."
            );
        }
    }
}

module.exports = RemoveGroupSubscriptionHandler;
