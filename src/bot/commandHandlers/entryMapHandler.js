const { validateSolanaAddress, recognizeArgType } = require('./helpers.js');
const EntryPriceAnalyzer = require('../../analysis/entryPriceAnalyzer');
const { formatEntryMapResponse } = require('../formatters/entryMapFormatter');
const logger = require('../../utils/logger');
const ActiveCommandsTracker = require('../commandsManager/activeCommandsTracker');

class EntryMapHandler {
    constructor(userManager, accessControl) {
        this.userManager = userManager;
        this.accessControl = accessControl;
        this.analyzer = new EntryPriceAnalyzer();
        this.COMMAND_NAME = 'entrymap';
    }

    async handleCommand(bot, msg, args, messageThreadId) {
        const userId = msg.from.id;
        logger.info(`Starting EntryMap command for user ${msg.from.username}`);

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

            if (!args || args.length < 1) {
                await bot.sendMessage(msg.chat.id,
                    "Please provide a token address.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }

            let tokenAddress, numHolders = 20;

            args.forEach(arg => {
                const { type, value } = recognizeArgType(arg);
                if (type === 'solanaAddress') {
                    tokenAddress = value;
                } else if (type === 'number') {
                    numHolders = parseInt(value);
                }
            });

            if (!validateSolanaAddress(tokenAddress)) {
                await bot.sendMessage(msg.chat.id,
                    "Invalid token address format.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }

            const statusMsg = await bot.sendMessage(msg.chat.id,
                "⏳ Analyzing top holders entry prices...\nThis might take a few minutes.",
                { message_thread_id: messageThreadId }
            );

            const entryMap = await this.analyzer.analyzeTokenEntries(
                tokenAddress,
                numHolders,
                'entrymap',
                msg.from.username
            );

            const formattedResponse = formatEntryMapResponse(entryMap);

            await bot.editMessageText(formattedResponse, {
                chat_id: msg.chat.id,
                message_id: statusMsg.message_id,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });

        } catch (error) {
            logger.error('Error in entrymap command:', error);
            await bot.sendMessage(msg.chat.id,
                "An error occurred while analyzing entry prices.",
                { message_thread_id: messageThreadId }
            );
        } finally {
            this._finalizeCommand(userId);
        }
    }

    _finalizeCommand(userId) {
        logger.debug('EntryMap command completed');
        ActiveCommandsTracker.removeCommand(userId, this.COMMAND_NAME);
    }
}

module.exports = EntryMapHandler;