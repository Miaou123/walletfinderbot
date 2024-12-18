const logger = require('../../utils/logger');
const { searchWallets } = require('../../analysis/walletSearcher');
const ActiveCommandsTracker = require('../commandsManager/activeCommandsTracker');

class SearchHandler {
    constructor(userManager, accessControl) {
        this.userManager = userManager;
        this.accessControl = accessControl;
        this.COMMAND_NAME = 'search';
    }

    async handleCommand(bot, msg, args, messageThreadId) {
        const userId = msg.from.id;
        logger.info(`Starting Search command for user ${msg.from.username}`);

        try {
            // Vérifier si l'utilisateur peut exécuter une nouvelle commande
            if (!ActiveCommandsTracker.canAddCommand(userId, this.COMMAND_NAME)) {
                await bot.sendMessage(msg.chat.id,
                    "You already have 3 active commands. Please wait for them to complete.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }

            // Ajouter la commande au tracker
            if (!ActiveCommandsTracker.addCommand(userId, this.COMMAND_NAME)) {
                await bot.sendMessage(msg.chat.id,
                    "Unable to add a new command at this time.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }

            const { tokenAddress, searchCriteria } = this._parseArgs(args);

            if (!tokenAddress) {
                await bot.sendLongMessage(
                    msg.chat.id,
                    "Please provide a token address.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }
            
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
        ActiveCommandsTracker.removeCommand(userId, this.COMMAND_NAME);
    }
}

module.exports = SearchHandler;