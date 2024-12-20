const logger = require('../../utils/logger');
const { analyzeBestTraders } = require('../../analysis/bestTraders');
const { formatBestTraders } = require('../formatters/bestTradersFormatter');
const { RequestCache, cachedCommand } = require('../../utils/requestCache');
const { validateSolanaAddress } = require('./helpers');

class BestTradersHandler {
    constructor() {
        this.cache = new RequestCache(5 * 60 * 1000);
        this.COMMAND_NAME = 'besttraders';
    }

    async handleCommand(bot, msg, args, messageThreadId) {
        const username = msg.from.username;
        logger.info(`Starting BestTrader command for user ${username}`);

        try {
            const parsedArgs = this._parseArguments(args);

            // Validation de l'adresse solana
            if (!validateSolanaAddress(parsedArgs.contractAddress)) {
                await bot.sendLongMessage(
                    msg.chat.id,
                    "Invalid Solana address. Please provide a valid Solana address.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }

            await this._sendInitialMessage(bot, msg.chat.id, parsedArgs, messageThreadId);

            const cacheParams = {
                contractAddress: parsedArgs.contractAddress,
                winrateThreshold: parsedArgs.winrateThreshold,
                portfolioThreshold: parsedArgs.portfolioThreshold,
                sortOption: parsedArgs.sortOption
            };

            const fetchFunction = async () => {
                return await analyzeBestTraders(
                    parsedArgs.contractAddress,
                    parsedArgs.winrateThreshold,
                    parsedArgs.portfolioThreshold,
                    parsedArgs.sortOption,
                    'bestTraders'
                );
            };

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
            throw error;
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
}

module.exports = BestTradersHandler;
