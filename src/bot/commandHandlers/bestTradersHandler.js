const logger = require('../../utils/logger');
const { analyzeBestTraders } = require('../../analysis/bestTraders');
const { formatBestTraders } = require('../formatters/bestTradersFormatter');
const ActiveCommandsTracker = require('../commandsManager/activeCommandsTracker');
const { RequestCache, cachedCommand } = require('../../utils/requestCache');

class BestTradersHandler {
    constructor(userManager, accessControl) {
        this.userManager = userManager;
        this.accessControl = accessControl;
        this.cache = new RequestCache(5 * 60 * 1000);
        this.COMMAND_NAME = 'bt';
    }

    async handleCommand(bot, msg, args, messageThreadId) {
        const userId = msg.from.id;
        logger.info(`Starting BestTrader command for user ${msg.from.username}`);

        try {
            // Vérifier si l'utilisateur peut exécuter une nouvelle commande
            if (!ActiveCommandsTracker.canAddCommand(userId, this.COMMAND_NAME)) {
                await bot.sendLongMessage(
                    msg.chat.id,
                    "You already have 3 active commands. Please wait for them to complete.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }

            // Ajouter la commande au tracker
            if (!ActiveCommandsTracker.addCommand(userId, this.COMMAND_NAME)) {
                await bot.sendLongMessage(
                    msg.chat.id,
                    "Unable to add a new command.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }

            // Parse les arguments
            const parsedArgs = this._parseArguments(args);
            
            await this._sendInitialMessage(bot, msg.chat.id, parsedArgs, messageThreadId);

            const cacheParams = {
                contractAddress: parsedArgs.contractAddress,
                winrateThreshold: parsedArgs.winrateThreshold,
                portfolioThreshold: parsedArgs.portfolioThreshold,
                sortOption: parsedArgs.sortOption
            };

            // Fonction de récupération des données
            const fetchFunction = async () => {
                return await analyzeBestTraders(
                    parsedArgs.contractAddress,
                    parsedArgs.winrateThreshold,
                    parsedArgs.portfolioThreshold,
                    parsedArgs.sortOption,
                    'bestTraders'
                );
            };

            // Utilisation du cachedCommand
            const bestTraders = await cachedCommand(
                this.cache,
                '/bt',
                cacheParams,
                fetchFunction
            );

            if (bestTraders.length === 0) {
                await bot.sendLongMessage(
                    msg.chat.id,
                    "No traders found meeting the criteria.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }

            const message = formatBestTraders(bestTraders);

            await bot.sendLongMessage(
                msg.chat.id,
                message,
                {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                    message_thread_id: messageThreadId
                }
            );

        } catch (error) {
            logger.error('Error in handleBestTradersCommand:', error);
            await bot.sendLongMessage(
                msg.chat.id,
                `An error occurred while processing your request: ${error.message}`,
                { message_thread_id: messageThreadId }
            );
        } finally {
            // S'assurer que la commande est toujours supprimée à la fin
            this._finalizeCommand(userId);
        }
    }

    _parseArguments(args) {
        const [contractAddress, ...otherArgs] = args;
        let winrateThreshold = 50;
        let portfolioThreshold = 10000;
        let sortOption = 'winrate';

        for (const arg of otherArgs) {
            const lowercaseArg = arg.toLowerCase();
            if (['pnl', 'winrate', 'wr', 'portfolio', 'port', 'sol'].includes(lowercaseArg)) {
                sortOption = lowercaseArg;
            } else {
                const num = parseFloat(arg);
                if (!isNaN(num)) {
                    if (num >= 0 && num <= 100) {
                        winrateThreshold = num;
                    } else if (num > 100 && num <= 1000000) {
                        portfolioThreshold = num;
                    }
                }
            }
        }

        return {
            contractAddress,
            winrateThreshold,
            portfolioThreshold,
            sortOption
        };
    }

    async _sendInitialMessage(bot, chatId, parsedArgs, messageThreadId) {
        const message = [
            `Analyzing best traders for contract: ${parsedArgs.contractAddress}`,
            `Winrate threshold: >${parsedArgs.winrateThreshold}%`,
            `Portfolio threshold: >$${parsedArgs.portfolioThreshold}`,
            `Sorting by: ${parsedArgs.sortOption}`
        ].join('\n');

        await bot.sendLongMessage(chatId, message, { message_thread_id: messageThreadId });
    }

    _finalizeCommand(userId) {
        logger.debug('bestTraders command completed');
        ActiveCommandsTracker.removeCommand(userId, this.COMMAND_NAME);
    }
}

module.exports = BestTradersHandler;