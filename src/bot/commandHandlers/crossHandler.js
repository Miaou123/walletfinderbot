const logger = require('../../utils/logger');
const CrossAnalyzer = require('../../analysis/crossAnalyzer');
const { formatCrossAnalysisMessage } = require('../formatters/crossAnalysisFormatter');
const PaginationUtils = require('../../utils/paginationUtils');
const gmgnApi = require('../../integrations/gmgnApi');
const { getSolanaApi } = require('../../integrations/solanaApi');

class CrossHandler {
    constructor() {
        this.crossAnalyzer = new CrossAnalyzer();
        this.COMMAND_NAME = 'cross';
        this.MAX_RESULTS_PER_PAGE = 5;
    }

    async handleCommand(bot, msg, args, messageThreadId) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        
        logger.info(`Cross command called by ${msg.from.username || msg.from.id}`);
        
        try {
            // Parse contract addresses from args
            const contractAddresses = args;
            
            if (!contractAddresses || contractAddresses.length < 2) {
                await bot.sendMessage(
                    chatId,
                    "Please provide at least two contract addresses to analyze.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }
            
            if (contractAddresses.length > 4) {
                await bot.sendMessage(
                    chatId,
                    "Too many contract addresses. Please limit to 4 addresses maximum.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }
            
            // Parse options
            const options = {
                minTokenThreshold: 10000,
                minCombinedValue: 1000
            };

            // Send loading message
            const loadingMsg = await bot.sendMessage(
                chatId,
                `Analyzing cross-holdings for ${contractAddresses.length} tokens...`,
                { message_thread_id: messageThreadId }
            );
            
            // Fetch token info to display in results
            const tokenInfos = await Promise.all(contractAddresses.map(async (address) => {
                try {
                    const solanaApi = getSolanaApi();
                    const tokenMetadata = await solanaApi.getAsset(address, 'Cross', 'getTokenInfo');
                    
                    return {
                        address,
                        symbol: tokenMetadata?.symbol || 'Unknown',
                        name: tokenMetadata?.name || 'Unknown Token'
                    };
                } catch (error) {
                    logger.error(`Failed to get token info for ${address}:`, error);
                    return {
                        address,
                        symbol: 'Unknown',
                        name: 'Unknown Token'
                    };
                }
            }));
            
            // Get cross analysis
            const crossResults = await this.crossAnalyzer.crossAnalyze(contractAddresses, 'Cross');
            
            // Delete loading message
            try {
                await bot.deleteMessage(chatId, loadingMsg.message_id);
            } catch (error) {
                logger.warn('Failed to delete loading message:', error);
            }
            
            // Check if there are any results
            if (!crossResults || crossResults.length === 0) {
                await bot.sendMessage(
                    chatId,
                    "No common holders found for these tokens that match the criteria.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }
            
            // For group chats, use chatId as the state ID
            const stateId = msg.chat.type === 'private' ? userId : chatId;
            
            logger.info(`Found ${crossResults.length} holders with cross holdings, storing with stateId: ${stateId}`);
            
            // Store data for pagination
            const paginationState = PaginationUtils.storePaginationData(
                stateId, // Using stateId (chatId for groups, userId for private chats)
                this.COMMAND_NAME,
                crossResults,
                {
                    contractAddresses,
                    tokenInfos
                },
                this.MAX_RESULTS_PER_PAGE
            );
            
            // Get the first page of results
            const firstPageResults = PaginationUtils.getPageResults(
                crossResults,
                0,
                this.MAX_RESULTS_PER_PAGE
            );
            
            logger.debug(`Sending first page of ${firstPageResults.length} results with stateId: ${stateId}, totalPages: ${paginationState.totalPages}`);
            
            // Format the message
            const message = formatCrossAnalysisMessage(
                firstPageResults,
                contractAddresses,
                tokenInfos,
                0, // Current page
                paginationState.totalPages,
                crossResults.length,
                this.MAX_RESULTS_PER_PAGE,
                true, // Enable pagination
                crossResults // Pass all results for accurate statistics
            );
            
            // Create keyboard
            const keyboard = PaginationUtils.createPaginationKeyboard(
                this.COMMAND_NAME,
                0,
                paginationState.totalPages
            );
            
            // Send the message with pagination
            await bot.sendMessage(
                chatId,
                message,
                {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                    reply_markup: {
                        inline_keyboard: keyboard
                    },
                    message_thread_id: messageThreadId
                }
            );
            
        } catch (error) {
            logger.error('Error in cross command:', error);
            await bot.sendMessage(
                chatId,
                "An error occurred while analyzing common holders.",
                { message_thread_id: messageThreadId }
            );
        }
    }
    
    async handleCallback(bot, query) {
        try {
            const userId = query.from.id;
            const chatId = query.message.chat.id;
            const messageId = query.message.message_id;
            
            // For group chats, use chatId as the state ID
            const stateId = query.message.chat.type === 'private' ? userId : chatId;
            
            // Parse the callback data
            const parts = query.data.split(':');
            const command = parts[0];
            const action = parts[1];
            
            if (command !== this.COMMAND_NAME) {
                return; // Not for this handler
            }
            
            // Handle different actions
            if (action === 'page') {
                const pageNum = parseInt(parts[2], 10);
                
                // Use pagination utility to handle page navigation
                await PaginationUtils.handlePaginationCallback(bot, query, {
                    command: this.COMMAND_NAME,
                    action: action,
                    pageParam: pageNum,
                    
                    // Format function
                    formatFunction: (pageResults, metadata, page, totalPages, totalResults) => {
                        return formatCrossAnalysisMessage(
                            pageResults,
                            metadata.contractAddresses,
                            metadata.tokenInfos,
                            page,
                            totalPages,
                            totalResults,
                            this.MAX_RESULTS_PER_PAGE,
                            true,
                            state.results // Pass all results for accurate statistics
                        );
                    },
                    
                    // Create keyboard function
                    createKeyboardFunction: (command, page, totalPages) => {
                        return PaginationUtils.createPaginationKeyboard(
                            command,
                            page,
                            totalPages
                        );
                    }
                });
            }
            
            await bot.answerCallbackQuery(query.id);
            
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
}

module.exports = CrossHandler;