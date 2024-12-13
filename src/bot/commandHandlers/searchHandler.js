const logger = require('../../utils/logger');
const { searchWallets } = require('../../analysis/walletSearcher');
const ActiveCommandsTracker = require('../commandsManager/activeCommandsTracker');

class SearchHandler {
    constructor(userManager, accessControl) {
        this.userManager = userManager;
        this.accessControl = accessControl;
    }

    async handleCommand(bot, msg, args, messageThreadId) {
        const userId = msg.from.id;
        logger.info(`Starting Search command for user ${msg.from.username}`);

        try {
            const { tokenAddress, searchCriteria } = this._parseArgs(args);
            
            if (searchCriteria.length === 0) {
                await bot.sendLongMessage(
                    msg.chat.id,
                    "Please provide search criteria.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }

            await this._sendInitialMessage(bot, msg.chat.id, tokenAddress, messageThreadId);
            const results = await this._performSearch(tokenAddress, searchCriteria);
            await this._sendResults(bot, msg.chat.id, results, messageThreadId);

        } catch (error) {
            logger.error('Error in handleSearchCommand:', error);
            await bot.sendLongMessage(
                msg.chat.id,
                `An error occurred during the search: ${error.message}`,
                { message_thread_id: messageThreadId }
            );
        } finally {
            this._finalizeCommand(userId);
        }
    }

    _parseArgs(args) {
        const [tokenAddress, ...searchCriteria] = args;
        return { tokenAddress, searchCriteria };
    }

    async _sendInitialMessage(bot, chatId, tokenAddress, messageThreadId) {
        await bot.sendLongMessage(
            chatId,
            `Searching wallets for coin: ${tokenAddress}`,
            { message_thread_id: messageThreadId }
        );
    }

    async _performSearch(tokenAddress, searchCriteria) {
        return await searchWallets(tokenAddress, searchCriteria, 'searchWallet');
    }

    async _sendResults(bot, chatId, results, messageThreadId) {
        if (results.length === 0) {
            await bot.sendLongMessage(
                chatId,
                "No matching wallets found.",
                { message_thread_id: messageThreadId }
            );
            return;
        }

        let message = `Found ${results.length} matching wallet(s):\n\n`;
        message += results.join('');

        await bot.sendLongMessage(
            chatId,
            message,
            {
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                message_thread_id: messageThreadId
            }
        );
    }

    _finalizeCommand(userId) {
        logger.debug('Search command completed');
        ActiveCommandsTracker.removeCommand(userId, 'search');
    }
}

module.exports = SearchHandler;