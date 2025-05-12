const logger = require('../../utils/logger');
const { analyzeBestTraders } = require('../../analysis/bestTraders');
const { formatBestTraders, formatInitialMessage } = require('../formatters/bestTradersFormatter');
const { RequestCache, cachedCommand } = require('../../utils/requestCache');
const { validateSolanaAddress } = require('./helpers');
const PaginationUtils = require('../../utils/paginationUtils');

class BestTradersPaginatedHandler {
    constructor(stateManager) {
        this.cache = new RequestCache(5 * 60 * 1000);
        this.COMMAND_NAME = 'besttraders';
        this.stateManager = stateManager; // Store stateManager but we won't use it directly
        this.MAX_TRADERS_PER_PAGE = 5; // Adjusted for pagination
    }

    async handleCommand(bot, msg, args, messageThreadId) {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        const username = msg.from.username;
        
        logger.info(`Starting BestTrader command for user ${username}`);
    
        try {
            const parsedArgs = this._parseArguments(args);
            
            if (!validateSolanaAddress(parsedArgs.contractAddress)) {
                await bot.sendMessage(
                    chatId,
                    "Invalid Solana address. Please provide a valid Solana address.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }
    
            // Send initial loading message
            const initialMessage = await bot.sendMessage(
                chatId,
                formatInitialMessage(parsedArgs),
                { 
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                    message_thread_id: messageThreadId 
                }
            );
    
            // Fetch best traders data
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
    
            // Delete the loading message
            try {
                await bot.deleteMessage(chatId, initialMessage.message_id);
            } catch (error) {
                logger.warn('Failed to delete initial message:', error);
            }
    
            if (!bestTraders || bestTraders.length === 0) {
                await bot.sendMessage(
                    chatId,
                    "No traders found meeting the criteria.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }
            
            logger.info(`Found ${bestTraders.length} traders with winrate > ${parsedArgs.winrateThreshold}% and portfolio value > $${parsedArgs.portfolioThreshold}, sorted by ${parsedArgs.sortOption}`);
            
            // Store results for pagination using the PaginationUtils
            const paginationState = PaginationUtils.storePaginationData(
                userId,
                this.COMMAND_NAME,
                bestTraders,
                { parsedArgs },
                this.MAX_TRADERS_PER_PAGE
            );
            
            // Get first page of results
            const firstPageTraders = PaginationUtils.getPageResults(
                bestTraders, 
                0, 
                this.MAX_TRADERS_PER_PAGE
            );
            
            // Create paginated message
            const formattedMessage = formatBestTraders(
                firstPageTraders.map(trader => ({
                    wallet: trader.wallet,
                    data: trader.data
                })), 
                parsedArgs,
                true // Enable pagination mode
            );
            
            // Create pagination keyboard using the utilities
            const keyboard = PaginationUtils.createPaginationKeyboard(
                this.COMMAND_NAME,
                0,
                paginationState.totalPages
            );
            
            // Send paginated message using the utility
            await PaginationUtils.sendPaginatedMessage(
                bot,
                chatId,
                formattedMessage,
                keyboard,
                { message_thread_id: messageThreadId }
            );
        } catch (error) {
            logger.error('Error in handleBestTradersCommand:', error);
            await bot.sendMessage(
                chatId,
                "An error occurred while processing your request. Please try again later.",
                { message_thread_id: messageThreadId }
            );
        }
    }
    
    /**
     * Handle callback queries for pagination
     * @param {Object} bot - The telegram bot instance
     * @param {Object} query - The callback query
     */
    async handleCallback(bot, query) {
        try {
            const userId = query.from.id;
            
            // Parse the callback data
            const [command, action, pageStr] = query.data.split(':');
            
            if (command !== this.COMMAND_NAME) {
                return; // Not for this handler
            }
            
            // Handle 'none' action - do nothing but acknowledge the query
            if (action === 'none') {
                await bot.answerCallbackQuery(query.id);
                return;
            }
            
            // For page navigation
            if (action === 'page') {
                // Use the pagination utilities to handle page navigation
                await PaginationUtils.handlePaginationCallback(bot, query, {
                    command: this.COMMAND_NAME,
                    action: action,
                    pageParam: pageStr,
                    
                    // Provide format function that will be called with page results
                    formatFunction: (pageResults, metadata, page, totalPages, totalResults, itemsPerPage) => {
                        return formatBestTraders(
                            pageResults.map(trader => ({
                                wallet: trader.wallet,
                                data: trader.data
                            })), 
                            metadata.parsedArgs,
                            true // Enable pagination mode
                        );
                    },
                    
                    // Provide keyboard creation function
                    createKeyboardFunction: (command, page, totalPages) => {
                        return PaginationUtils.createPaginationKeyboard(
                            command,
                            page,
                            totalPages
                        );
                    }
                });
            }
        } catch (error) {
            logger.error(`Error handling ${this.COMMAND_NAME} callback:`, error);
            try {
                await bot.answerCallbackQuery(query.id, {
                    text: "An error occurred. Please try running the command again.",
                    show_alert: true
                });
            } catch (answerError) {
                logger.error('Failed to answer callback query:', answerError);
            }
        }
    }

    _parseArguments(args) {
        const [contractAddress, ...otherArgs] = args;
        let winrateThreshold = 30;
        let portfolioThreshold = 5000;
        let sortOption = 'winrate';

        for (const arg of otherArgs) {
            const lowercaseArg = arg.toLowerCase();
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

module.exports = BestTradersPaginatedHandler;