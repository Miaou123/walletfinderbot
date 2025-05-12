const logger = require('../../utils/logger');
const { validateAndFormatAddress, recognizeArgType } = require('./helpers');
const { getSolanaApi } = require('../../integrations/solanaApi');
const crossAnalyzer = require('../../analysis/crossAnalyzer');
const { formatCrossAnalysisMessage } = require('../formatters/crossAnalysisFormatter');
const PaginationUtils = require('../../utils/paginationUtils');

class CrossPaginatedHandler {
    constructor(stateManager) {
        this.DEFAULT_MIN_VALUE = 1000;
        this.analyzer = new crossAnalyzer();
        this.solanaApi = getSolanaApi();
        this.COMMAND_NAME = 'cross';
        this.MAX_HOLDERS_PER_PAGE = 5; // For pagination
        this.stateManager = stateManager; // Store stateManager but we won't use it directly
    }

    async handleCommand(bot, msg, args, messageThreadId) {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        
        logger.info(`Starting Cross command for user ${msg.from.username}`);

        try {
            if (args.length < 2) {
                await bot.sendMessage(chatId, 
                    "Please provide at least two valid addresses and optionally a minimum combined value.", 
                    { message_thread_id: messageThreadId }
                );
                return;
            }

            const { contractAddresses, minValue } = this.parseArgs(args);

            if (contractAddresses.length < 2) {
                await bot.sendMessage(chatId, 
                    "Please provide at least two valid addresses.", 
                    { message_thread_id: messageThreadId }
                );
                return;
            }

            // Send loading message
            const statusMsg = await bot.sendMessage(chatId, 
                `Starting cross-analysis for ${contractAddresses.length} tokens with minimum combined value of $${minValue}...`, 
                { message_thread_id: messageThreadId }
            );

            // Fetch token details
            const tokenDetails = await Promise.all(contractAddresses.map(async (addr) => {
                const { isValid, formattedAddress } = validateAndFormatAddress(addr, 'solana');
                return isValid ? this.solanaApi.getAsset(formattedAddress, 'cross') : null;
            }));

            if (tokenDetails.some(detail => !detail)) {
                await bot.editMessageText("Error fetching token details. Ensure all addresses are valid.", {
                    chat_id: chatId,
                    message_id: statusMsg.message_id,
                    message_thread_id: messageThreadId
                });
                return;
            }

            // Run cross analysis
            const relevantHolders = await this.analyzer.crossAnalyze(contractAddresses);

            if (!relevantHolders.length) {
                await bot.editMessageText("No relevant holders found matching the criteria.", {
                    chat_id: chatId,
                    message_id: statusMsg.message_id,
                    message_thread_id: messageThreadId
                });
                return;
            }
            
            // Filter holders by minimum value
            const filteredHolders = relevantHolders.filter(holder => holder.combinedValue >= minValue)
                .sort((a, b) => b.combinedValue - a.combinedValue);
                
            if (!filteredHolders.length) {
                await bot.editMessageText(
                    `No holders found with combined value above $${minValue}. Try lowering the minimum value.`, 
                    {
                        chat_id: chatId,
                        message_id: statusMsg.message_id,
                        message_thread_id: messageThreadId
                    }
                );
                return;
            }
            
            // Delete loading message
            try {
                await bot.deleteMessage(chatId, statusMsg.message_id);
            } catch (error) {
                logger.warn('Failed to delete loading message:', error);
            }
            
            // Store results for pagination - now using PaginationUtils with the imported stateManager
            const paginationState = PaginationUtils.storePaginationData(
                userId,
                this.COMMAND_NAME,
                filteredHolders,
                { 
                    contractAddresses, 
                    tokenDetails,
                    minValue
                },
                this.MAX_HOLDERS_PER_PAGE
            );
            
            // Get first page of results
            const firstPageHolders = PaginationUtils.getPageResults(
                filteredHolders,
                0,
                paginationState.itemsPerPage
            );
            
            // Format the first page message
            const formattedMessage = formatCrossAnalysisMessage(
                firstPageHolders,
                contractAddresses,
                tokenDetails,
                0,  // page number
                paginationState.totalPages,
                filteredHolders.length,
                paginationState.itemsPerPage,
                true // isPaginated
            );
            
            // Create pagination keyboard
            const keyboard = PaginationUtils.createPaginationKeyboard(
                this.COMMAND_NAME,
                0,
                paginationState.totalPages
            );
            
            // Send paginated message
            await PaginationUtils.sendPaginatedMessage(
                bot,
                chatId,
                formattedMessage,
                keyboard,
                { message_thread_id: messageThreadId }
            );
        } catch (error) {
            logger.error('Error in cross command:', error);
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
            const parts = query.data.split(':');
            const command = parts[0];
            const action = parts[1];
            
            if (command !== this.COMMAND_NAME) {
                return; // Not for this handler
            }
            
            // Handle 'none' action
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
                    pageParam: parts[2],
                    
                    // Format function for cross analysis
                    formatFunction: (pageResults, metadata, page, totalPages, totalResults, itemsPerPage) => {
                        return formatCrossAnalysisMessage(
                            pageResults,
                            metadata.contractAddresses,
                            metadata.tokenDetails,
                            page,
                            totalPages,
                            totalResults,
                            itemsPerPage,
                            true // isPaginated
                        );
                    },
                    
                    // Create pagination keyboard
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

    parseArgs(args) {
        const contractAddresses = [];
        let minValue = this.DEFAULT_MIN_VALUE;

        args.forEach(arg => {
            const recognized = recognizeArgType(arg);
            if (recognized.type === 'solanaAddress' || recognized.type === 'ethereumAddress') {
                const { isValid, formattedAddress } = validateAndFormatAddress(recognized.value, recognized.type === 'solanaAddress' ? 'solana' : 'ethereum');
                if (isValid) {
                    contractAddresses.push(formattedAddress);
                }
            } else if (!isNaN(Number(arg)) && contractAddresses.length >= 2) {
                minValue = parseFloat(arg);
            }
        });

        return { contractAddresses, minValue };
    }
}

module.exports = CrossPaginatedHandler;