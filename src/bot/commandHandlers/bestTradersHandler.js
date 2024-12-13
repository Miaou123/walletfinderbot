const logger = require('../../utils/logger');
const { analyzeBestTraders } = require('../../analysis/bestTraders');
const { formatBestTraders } = require('../formatters/bestTradersFormatter');
const ActiveCommandsTracker = require('../commandsManager/activeCommandsTracker');

class BestTradersHandler {
    constructor(userManager, accessControl) {
        this.userManager = userManager;
        this.accessControl = accessControl;
    }

    async handleCommand(bot, msg, args, messageThreadId) {
        const userId = msg.from.id;
        logger.info(`Starting BestTrader command for user ${msg.from.username}`);

        try {
            const parsedArgs = this._parseArguments(args);
            
            await this._sendInitialMessage(bot, msg.chat.id, parsedArgs, messageThreadId);
            
            const bestTraders = await analyzeBestTraders(
                parsedArgs.contractAddress,
                parsedArgs.winrateThreshold,
                parsedArgs.portfolioThreshold,
                parsedArgs.sortOption,
                'bestTraders'
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
        ActiveCommandsTracker.removeCommand(userId, 'bt');
    }
}

module.exports = BestTradersHandler;