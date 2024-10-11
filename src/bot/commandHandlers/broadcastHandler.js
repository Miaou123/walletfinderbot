const logger = require('../../utils/logger');

class BroadcastHandler {
  constructor(userManager, accessControl) {
    this.userManager = userManager;
    this.accessControl = accessControl;
  }

  async handleBroadcastCommand(bot, msg) {
    const chatId = msg.chat.id;
    const adminUsername = msg.from.username;

    if (!this.accessControl.isAdmin(adminUsername)) {
      await bot.sendMessage(chatId, "You are not authorized to use this command.");
      return;
    }

    const fullMessage = msg.text.slice('/broadcast'.length).trim();

    if (!fullMessage) {
      await bot.sendMessage(chatId, "Please provide a message to broadcast.");
      return;
    }

    try {
      const { successCount, failCount } = await this.broadcastMessage(bot, fullMessage);
      await bot.sendMessage(chatId, `Broadcast sent.\nSuccessful: ${successCount}\nFailed: ${failCount}`);
    } catch (error) {
      logger.error('Error in broadcast:', error.message || error);
      await bot.sendMessage(chatId, "An error occurred while broadcasting the message.");
    }
  }

  async broadcastMessage(bot, message) {
    console.log('BroadcastHandler: Starting broadcast');
    const allUsers = this.userManager.debugUsers();
    console.log(`BroadcastHandler: Retrieved ${allUsers.length} users for broadcasting`);
    
    let successCount = 0;
    let failCount = 0;

    for (const [userId, userData] of allUsers) {
      try {
        console.log(`Attempting to send message to user ${userId} (${userData.username})`);
        await bot.sendMessage(userData.chatId, message, { parse_mode: 'HTML', disable_web_page_preview: true });
        successCount++;
        console.log(`Successfully sent broadcast to user ${userId} (${userData.username})`);
      } catch (error) {
        failCount++;
        console.error(`Failed to send broadcast message to user ${userId} (${userData.username}):`, error.message || error);
      }
    }

    console.log(`Broadcast complete. Successful: ${successCount}, Failed: ${failCount}`);
    return { successCount, failCount };
  }
}

module.exports = BroadcastHandler;
