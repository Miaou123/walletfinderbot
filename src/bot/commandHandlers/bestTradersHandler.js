const logger = require('../../utils/logger');
const { analyzeBestTraders } = require('../../analysis/bestTraders');
const { formatBestTraders, formatInitialMessage } = require('../formatters/bestTradersFormatter');
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
            
            if (!validateSolanaAddress(parsedArgs.contractAddress)) {
                await bot.sendMessage(
                    msg.chat.id,
                    "Invalid Solana address. Please provide a valid Solana address.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }
    
            // Envoyer le message initial avec sendMessage directement
            const initialMessage = await bot.sendMessage(
                msg.chat.id,
                formatInitialMessage(parsedArgs),
                { 
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                    message_thread_id: messageThreadId 
                }
            );
    
            const bestTraders = await cachedCommand(
                this.cache,
                '/bt',
                parsedArgs,
                () => analyzeBestTraders(
                    parsedArgs.contractAddress,
                    parsedArgs.winrateThreshold,
                    parsedArgs.portfolioThreshold,
                    parsedArgs.sortOption,
                    'bestTraders'
                )
            );
    
            // Supprimer le message initial
            try {
                await bot.deleteMessage(msg.chat.id, initialMessage.message_id);
            } catch (error) {
                logger.warn('Failed to delete initial message:', error);
            }
    
            if (bestTraders.length === 0) {
                await bot.sendLongMessage(
                    msg.chat.id,
                    "No traders found meeting the criteria.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }
    
            // Envoyer le message final avec sendLongMessage
            const finalMessage = formatBestTraders(bestTraders, parsedArgs);
            await bot.sendLongMessage(
                msg.chat.id,
                finalMessage,
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
        let winrateThreshold = 30;
        let portfolioThreshold = 5000;
        let sortOption = 'winrate';

        for (const arg of otherArgs) {
            const lowercaseArg = arg.toLowerCase();
            // Ajout de 'totalpnl' dans les options de tri
            if (['pnl', 'winrate', 'wr', 'portfolio', 'port', 'sol', 'rank', 'totalpnl'].includes(lowercaseArg)) {
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
}

module.exports = BestTradersHandler;