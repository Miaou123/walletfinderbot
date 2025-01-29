const BaseAdminHandler = require('../baseAdminHandler');
const logger = require('../../../../utils/logger');

class ListGroupSubscriptionsHandler extends BaseAdminHandler {
    constructor(accessControl, bot) {
        super(accessControl, bot);
    }

    async handle(msg) {
        const chatId = String(msg.chat.id);
        const userId = msg.from.id;

        try {
            if (!await this.checkAdmin(userId)) {
                return;
            }

            const now = new Date();
            const groupSubscriptions = await this.accessControl.subscriptionService.getGroupSubscriptionList();

            console.log("Group Subscriptions found:", groupSubscriptions);

            const activeGroupSubscriptions = groupSubscriptions.filter(
                sub => new Date(sub.expiresAt) > now
            );

            if (activeGroupSubscriptions.length === 0) {
                await this.bot.sendMessage(chatId, "📝 No active group subscriptions found.");
                return;
            }

            let message = "🏢 Active Group Subscriptions:\n\n";

            for (const sub of activeGroupSubscriptions) {
                const daysLeft = Math.ceil((new Date(sub.expiresAt) - now) / (1000 * 60 * 60 * 24));
                message += `✅ Group: ${sub.groupName}\n`;
                message += `⏳ Days remaining: ${daysLeft}\n`;
                message += `📅 Expires: ${new Date(sub.expiresAt).toLocaleDateString()}\n\n`;
            }

            message += `\n📈 Total active group subscriptions: ${activeGroupSubscriptions.length}`;

            await this.bot.sendMessage(chatId, message);

        } catch (error) {
            logger.error('Error in listgroupsubs command:', error);
            await this.bot.sendMessage(chatId, "❌ An error occurred while listing group subscriptions.");
        }
    }
}

module.exports = ListGroupSubscriptionsHandler;
