const logger = require('../../utils/logger');
const TokenAnalyzer = require('../../analysis/topHoldersAnalyzer');
const { 
    formatAnalysisMessage, 
    calculateCategoryStats 
} = require('../formatters/topHoldersFormatter');
const { RequestCache, cachedCommand } = require('../../utils/requestCache');
const PaginationUtils = require('../../utils/paginationUtils');
const stateManager = require('../../utils/stateManager');
const addressCategorization = require('../../utils/addressCategorization');

class TopHoldersPaginatedHandler {
    constructor(stateManager) {
        this.tokenAnalyzer = new TokenAnalyzer();
        this.MAX_HOLDERS = 100;
        this.DEFAULT_HOLDERS = 20;
        this.MAX_HOLDERS_PER_PAGE = 5; // For pagination
        this.cache = new RequestCache(5 * 60 * 1000);
        this.COMMAND_NAME = 'topholders';
        // this.stateManager = stateManager; // We won't use this
    }

    async handleCommand(bot, msg, args, messageThreadId) {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        
        // Use chatId for groups, userId for private chats to enable shared pagination in groups
        const stateId = msg.chat.type === 'private' ? userId : chatId;
        
        logger.info(`Starting TopHolders command for user ${msg.from.username} in chat ${chatId}`);
    
        try {
            const [coinAddress, topHoldersCountStr] = args;
    
            if (!coinAddress) {
                await bot.sendMessage(
                    chatId,
                    "Please provide a token address.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }
    
            const requestedCount = parseInt(topHoldersCountStr) || this.DEFAULT_HOLDERS;
            const count = Math.min(Math.max(1, requestedCount), this.MAX_HOLDERS);
    
            if (isNaN(count)) {
                await bot.sendMessage(
                    chatId,
                    "Invalid number of holders. Please provide a number between 1 and 100.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }
            
            // Send loading message
            const loadingMsg = await bot.sendMessage(
                chatId,
                `Analyzing top ${count} holders for ${coinAddress}. This might take a moment...`,
                { message_thread_id: messageThreadId }
            );
    
            // Use cache to fetch or analyze token
            const cacheParams = { coinAddress, count };
            const fetchFunction = async () => {
                return await this.tokenAnalyzer.analyzeToken(
                    coinAddress,
                    count,
                    'Analyze'
                );
            };
    
            const { tokenInfo, analyzedWallets } = await cachedCommand(
                this.cache,
                '/th',
                cacheParams,
                fetchFunction
            );
            
            // Delete loading message
            try {
                await bot.deleteMessage(chatId, loadingMsg.message_id);
            } catch (error) {
                logger.warn('Failed to delete loading message:', error);
            }
    
            if (!analyzedWallets || analyzedWallets.length === 0) {
                await bot.sendMessage(
                    chatId,
                    "No wallets found for analysis.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }
            
            // Categorize wallets
            const categorizedWallets = {
                'High Value': analyzedWallets.filter(w => w.category === 'High Value'),
                'Low Transactions': analyzedWallets.filter(w => w.category === 'Low Transactions'),
                'Inactive': analyzedWallets.filter(w => w.category === 'Inactive')
            };
            
            // Process all wallets to identify known wallets (DEX, exchanges, etc.)
            analyzedWallets.forEach(wallet => {
                const addressInfo = addressCategorization.getAddressInfo(wallet.address);
                if (addressInfo) {
                    wallet.knownAddress = true;
                    wallet.addressName = addressInfo.name;
                    wallet.addressCategory = addressInfo.category;
                }
            });
            
            // Special wallets (DEX, exchanges, bridges) should be included regardless of category
            const specialWallets = analyzedWallets.filter(w => 
                w.knownAddress && 
                (w.addressCategory === 'DEX' || 
                 w.addressCategory === 'Exchange' || 
                 w.addressCategory === 'Bridge')
            );
            
            // Combine wallets for the 'All' view (only categorized and special wallets)
            const filteredWallets = [
                ...categorizedWallets['High Value'],
                ...categorizedWallets['Low Transactions'],
                ...categorizedWallets['Inactive'],
                ...specialWallets.filter(sw => 
                    !categorizedWallets['High Value'].some(hw => hw.address === sw.address) &&
                    !categorizedWallets['Low Transactions'].some(lw => lw.address === sw.address) &&
                    !categorizedWallets['Inactive'].some(iw => iw.address === sw.address)
                )
            ];

            // Sort the filtered wallets by percentage holding (descending)
            filteredWallets.sort((a, b) => {
                const aPercent = parseFloat(a.supplyPercentage) || 0;
                const bPercent = parseFloat(b.supplyPercentage) || 0;
                return bPercent - aPercent;
            });
            
            // Calculate category stats for the header
            const categoryStats = calculateCategoryStats(categorizedWallets);
            
            // Calculate category counts for the summary
            const categoryCounts = {
                whales: categorizedWallets['High Value'].length,
                fresh: categorizedWallets['Low Transactions'].length,
                inactive: categorizedWallets['Inactive'].length,
                dex: analyzedWallets.filter(w => w.knownAddress && w.addressCategory === 'DEX').length,
                exchange: analyzedWallets.filter(w => w.knownAddress && w.addressCategory === 'Exchange').length,
                bridge: analyzedWallets.filter(w => w.knownAddress && w.addressCategory === 'Bridge').length
            };
            
            // Store data for pagination using the pagination utilities
            const paginationState = PaginationUtils.storePaginationData(
                stateId, // Use stateId (chatId for groups, userId for private) instead of just userId
                this.COMMAND_NAME,
                analyzedWallets, // Store ALL wallets for pagination
                { 
                    tokenInfo,
                    categoryStats,
                    categorizedWallets,
                    currentCategory: 'All', // Start with all wallets view
                    categoryCounts // Store the category counts
                },
                this.MAX_HOLDERS_PER_PAGE
            );
            
            // Get first page of results
            const firstPageWallets = PaginationUtils.getPageResults(
                analyzedWallets, // Use ALL wallets for the "All" view
                0,
                this.MAX_HOLDERS_PER_PAGE
            );
            
            // Format the results using the formatter
            const { messages } = formatAnalysisMessage(
                firstPageWallets,
                tokenInfo,
                true, // isPaginated
                0,    // currentPage
                paginationState.totalPages,
                analyzedWallets.length, // Total number of wallets
                'All', // currentCategory
                categoryCounts // Pass category counts
            );
            
            // Create keyboard with category filter buttons and pagination buttons
            const keyboard = [
                // Category filter buttons
                ...this.createCategoryButtons('All'),
                // Pagination buttons from the utilities
                ...PaginationUtils.createPaginationKeyboard(
                    this.COMMAND_NAME,
                    0,
                    paginationState.totalPages
                )
            ];
            
            // Send paginated message using the utility
            await PaginationUtils.sendPaginatedMessage(
                bot,
                chatId,
                messages[0], // Get the first message from the formatter
                keyboard,
                { message_thread_id: messageThreadId }
            );
        } catch (error) {
            logger.error('Error in topholders command:', error);
            await bot.sendMessage(
                chatId,
                "An error occurred while processing your request. Please try again later.",
                { message_thread_id: messageThreadId }
            );
        }
    }
    
    /**
     * Create category filter buttons
     * @param {string} currentCategory - Currently selected category
     * @returns {Array} Keyboard rows with buttons
     */
    createCategoryButtons(currentCategory) {
        return [[
            {
                text: currentCategory === 'All' ? "✅ All" : "All",
                callback_data: `${this.COMMAND_NAME}:filter:All:0`
            },
            {
                text: currentCategory === 'High Value' ? "✅ Whales 🐳" : "Whales 🐳",
                callback_data: `${this.COMMAND_NAME}:filter:High Value:0`
            },
            {
                text: currentCategory === 'Low Transactions' ? "✅ Fresh 🆕" : "Fresh 🆕",
                callback_data: `${this.COMMAND_NAME}:filter:Low Transactions:0`
            },
            {
                text: currentCategory === 'Inactive' ? "✅ Inactive 💤" : "Inactive 💤",
                callback_data: `${this.COMMAND_NAME}:filter:Inactive:0`
            }
        ]];
    }
    
    /**
 * Handle callback queries for pagination and filtering
 * @param {Object} bot - The telegram bot instance
 * @param {Object} query - The callback query
 */
async handleCallback(bot, query) {
    try {
        const userId = query.from.id;
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        
        // Use chatId for groups, userId for private chats to match shared state
        const stateId = query.message.chat.type === 'private' ? userId : chatId;
        
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
                
                // Format function that handles the current category filter
                formatFunction: (pageResults, metadata, page, totalPages, totalResults, itemsPerPage) => {
                    const { messages } = formatAnalysisMessage(
                        pageResults,
                        metadata.tokenInfo,
                        true, // isPaginated
                        page,
                        totalPages,
                        totalResults,
                        metadata.currentCategory,
                        page === 0 ? metadata.categoryCounts : null // Only show counts on first page
                    );
                    return messages[0];
                },
                
                // Create keyboard function that includes category filters
                createKeyboardFunction: (command, page, totalPages, metadata) => {
                    return [
                        ...this.createCategoryButtons(metadata.currentCategory),
                        ...PaginationUtils.createPaginationKeyboard(
                            command,
                            page,
                            totalPages
                        )
                    ];
                }
            });
        }
        // For category filtering
        else if (action === 'filter') {
            const category = parts[2];
            
            // Get state using imported stateManager directly
            const state = stateManager.getUserState(stateId);
            
            if (!state || state.context !== 'pagination' || state.command !== this.COMMAND_NAME) {
                await bot.answerCallbackQuery(query.id, {
                    text: "This data is no longer available. Please run the command again.",
                    show_alert: true
                });
                return;
            }
            
            // Update category in state
            state.metadata.currentCategory = category;
            state.currentPage = 0; // Reset to first page when changing filter
            
            // Save the updated state
            stateManager.setUserState(stateId, state);
            
            // Filter wallets by category
            let filteredWallets = [];
            
            if (category === 'All') {
                // Store all wallets for 'All' category
                filteredWallets = [...state.results];
            } else {
                // Filter for specific category
                filteredWallets = state.results.filter(w => w.category === category);
            }
            
            // Sort by percentage holding (descending)
            filteredWallets.sort((a, b) => {
                const aPercent = parseFloat(a.supplyPercentage) || 0;
                const bPercent = parseFloat(b.supplyPercentage) || 0;
                return bPercent - aPercent;
            });
            
            // Calculate total pages for this filter
            const totalFilteredPages = Math.ceil(filteredWallets.length / state.itemsPerPage);
            
            // Get the first page of filtered results
            const pageResults = PaginationUtils.getPageResults(
                filteredWallets,
                0,
                state.itemsPerPage
            );
            
            // Format the page using the formatter
            const { messages } = formatAnalysisMessage(
                pageResults,
                state.metadata.tokenInfo,
                true, // isPaginated
                0,
                totalFilteredPages,
                filteredWallets.length,
                category,
                state.metadata.categoryCounts // Include category counts for first page
            );
            
            // Create keyboard with category and pagination buttons
            const keyboard = [
                ...this.createCategoryButtons(category),
                ...PaginationUtils.createPaginationKeyboard(
                    this.COMMAND_NAME,
                    0,
                    totalFilteredPages
                )
            ];
            
            // Update the message
            await bot.editMessageText(messages[0], {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: {
                    inline_keyboard: keyboard
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

module.exports = TopHoldersPaginatedHandler;