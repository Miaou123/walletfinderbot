/**
 * PaginationUtils - Centralized utilities for handling pagination in Telegram bot commands
 */
const logger = require('./logger');
const stateManager = require('./stateManager');

class PaginationUtils {
    /**
     * Generate callback data for buttons with consistent format
     * @param {string} category - Command/category name (e.g. 'topholders')
     * @param {string} action - Action to perform (e.g. 'page')
     * @param {any} param - Additional parameter (e.g. page number)
     * @returns {string} Formatted callback data
     */
    static generateCallbackData(category, action, param) {
        // Format: "category:action:param"
        return `${category}:${action}:${param}`;
    }
    
    /**
     * Create pagination keyboard with navigation buttons
     * @param {string} category - Command/category name for callback data
     * @param {number} currentPage - Current page number
     * @param {number} totalPages - Total number of pages
     * @returns {Array} Keyboard button rows
     */
    static createPaginationKeyboard(category, currentPage, totalPages) {
        const keyboard = [];
        
        // Only create pagination if there are multiple pages
        if (totalPages <= 1) {
            return keyboard;
        }
        
        // Navigation row
        const navigationRow = [];
        
        // Previous page button
        if (currentPage > 0) {
            navigationRow.push({
                text: "◀️ Prev",
                callback_data: this.generateCallbackData(category, 'page', currentPage - 1)
            });
        } else {
            navigationRow.push({
                text: "◀️ -",
                callback_data: this.generateCallbackData(category, 'none', 0)
            });
        }
        
        // Page indicator
        navigationRow.push({
            text: `${currentPage + 1}/${totalPages}`,
            callback_data: this.generateCallbackData(category, 'none', 0) 
        });
        
        // Next page button
        if (currentPage < totalPages - 1) {
            navigationRow.push({
                text: "Next ▶️",
                callback_data: this.generateCallbackData(category, 'page', currentPage + 1)
            });
        } else {
            navigationRow.push({
                text: "- ▶️",
                callback_data: this.generateCallbackData(category, 'none', 0)
            });
        }
        
        keyboard.push(navigationRow);
        
        // Add jump buttons if there are many pages
        if (totalPages > 5) {
            const jumpRow = [];
            
            // First page
            jumpRow.push({
                text: "1️⃣",
                callback_data: currentPage === 0 ? 
                    this.generateCallbackData(category, 'none', 0) : 
                    this.generateCallbackData(category, 'page', 0)
            });
            
            // Middle page
            const middlePage = Math.floor(totalPages / 2);
            jumpRow.push({
                text: `${middlePage + 1}`,
                callback_data: currentPage === middlePage ? 
                    this.generateCallbackData(category, 'none', 0) : 
                    this.generateCallbackData(category, 'page', middlePage)
            });
            
            // Last page
            jumpRow.push({
                text: `${totalPages}`,
                callback_data: currentPage === totalPages - 1 ? 
                    this.generateCallbackData(category, 'none', 0) : 
                    this.generateCallbackData(category, 'page', totalPages - 1)
            });
            
            keyboard.push(jumpRow);
        }
        
        return keyboard;
    }
    
    /**
     * Store results for pagination in state manager
     * @param {string} userId - User ID or Chat ID for groups
     * @param {string} command - Command name
     * @param {Array} results - Results to paginate
     * @param {Object} metadata - Additional metadata
     * @param {number} itemsPerPage - Items per page
     * @returns {Object} Pagination state
     */
    static storePaginationData(userId, command, results, metadata = {}, itemsPerPage = 5) {
        const paginationState = {
            context: 'pagination',
            command: command,
            results: results,
            metadata: metadata,
            itemsPerPage: itemsPerPage,
            currentPage: 0,
            totalPages: Math.ceil(results.length / itemsPerPage),
            timestamp: Date.now()
        };
        
        // Store in user state using the imported stateManager
        stateManager.setUserState(userId, paginationState);
        
        return paginationState;
    }
    
    /**
     * Get results for a specific page
     * @param {Array} results - All results
     * @param {number} page - Page number
     * @param {number} itemsPerPage - Items per page
     * @returns {Array} Results for the page
     */
    static getPageResults(results, page, itemsPerPage) {
        const startIndex = page * itemsPerPage;
        const endIndex = Math.min(startIndex + itemsPerPage, results.length);
        return results.slice(startIndex, endIndex);
    }
    
    /**
     * Update pagination page in state manager
     * @param {string} userId - User ID or Chat ID for groups
     * @param {number} newPage - New page number
     * @returns {Object|null} Updated state or null if not found
     */
    static updatePaginationPage(userId, newPage) {
        const state = stateManager.getUserState(userId);
        
        if (!state || state.context !== 'pagination') {
            return null;
        }
        
        // Ensure page is in valid range
        const totalPages = state.totalPages || 1;
        const validPage = Math.max(0, Math.min(newPage, totalPages - 1));
        
        // Update state
        state.currentPage = validPage;
        stateManager.setUserState(userId, state);
        
        return state;
    }
    
    /**
     * Check if pagination data is still valid (not too old)
     * @param {Object} paginationState - Pagination state
     * @param {number} maxAgeMinutes - Maximum age in minutes
     * @returns {boolean} Whether the data is still valid
     */
    static isPaginationDataValid(paginationState, maxAgeMinutes = 30) {
        if (!paginationState || !paginationState.timestamp) {
            return false;
        }
        
        const now = Date.now();
        const dataAge = now - paginationState.timestamp;
        const maxAge = maxAgeMinutes * 60 * 1000;
        
        return dataAge < maxAge;
    }
    
    /**
     * Send a paginated message with error handling
     * @param {Object} bot - Telegram bot instance
     * @param {number|string} chatId - Chat ID to send to
     * @param {string} message - Formatted message to send
     * @param {Array} keyboard - Keyboard markup
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} Sent message
     */
    static async sendPaginatedMessage(bot, chatId, message, keyboard, options = {}) {
        try {
            return await bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: {
                    inline_keyboard: keyboard
                },
                ...options
            });
        } catch (error) {
            // If message is too long, try to send a shorter version
            if (error.response && 
                error.response.body && 
                error.response.body.description && 
                error.response.body.description.includes('message is too long')) {
                
                logger.warn('Message too long for pagination, sending truncated version');
                
                // Create a shorter message
                const shorterMessage = message.substring(0, 3800) + '... (truncated due to length)';
                
                return await bot.sendMessage(chatId, shorterMessage, {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                    reply_markup: {
                        inline_keyboard: keyboard
                    },
                    ...options
                });
            }
            
            throw error;
        }
    }

    /**
     * Handle pagination callback queries
     * @param {Object} bot - Telegram bot instance
     * @param {Object} query - Callback query
     * @param {Object} options - Options for handling the callback
     * @returns {Promise<void>} 
     */
    static async handlePaginationCallback(bot, query, options) {
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const userId = query.from.id;
        
        // Use chatId for groups, userId for private chats
        const stateId = query.message.chat.type === 'private' ? userId : chatId;
        
        logger.debug(`Handling pagination callback. StateId: ${stateId}, Chat type: ${query.message.chat.type}`);
        
        try {
            // Parse options
            const { command, action, pageParam, formatFunction, createKeyboardFunction } = options;
            
            // Parse the desired page number
            let newPage = parseInt(pageParam, 10);
            if (isNaN(newPage)) {
                throw new Error(`Invalid page number: ${pageParam}`);
            }
            
            // Get current state from stateManager using stateId
            const state = stateManager.getUserState(stateId);
            
            // Validate state
            if (!state || state.context !== 'pagination' || state.command !== command) {
                logger.debug(`Invalid state for pagination. State exists: ${!!state}, Context: ${state?.context}, Command: ${state?.command}`);
                await bot.answerCallbackQuery(query.id, {
                    text: "This data is no longer available. Please run the command again.",
                    show_alert: true
                });
                return;
            }
            
            // Validate page number
            const totalPages = state.totalPages || 1;
            if (newPage < 0 || newPage >= totalPages) {
                newPage = Math.max(0, Math.min(newPage, totalPages - 1));
            }
            
            // Get results for the page
            const results = state.results || [];
            const itemsPerPage = state.itemsPerPage || 5;
            const pageResults = this.getPageResults(results, newPage, itemsPerPage);
            
            // Update current page in state
            state.currentPage = newPage;
            stateManager.setUserState(stateId, state);
            
            // Format the message using the provided function
            const formattedMessage = formatFunction(
                pageResults,
                state.metadata,
                newPage,
                totalPages,
                results.length,
                itemsPerPage
            );
            
            // Create keyboard using the provided function
            const keyboard = createKeyboardFunction(
                command,
                newPage,
                totalPages,
                state.metadata
            );
            
            // Update the message with new content
            await bot.editMessageText(formattedMessage, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: {
                    inline_keyboard: keyboard
                }
            });
            
            // Answer the callback query to remove loading state
            await bot.answerCallbackQuery(query.id);
            
        } catch (error) {
            logger.error(`Error handling pagination callback for command ${options.command}:`, error);
            
            try {
                // Always answer the callback query to prevent loading state
                await bot.answerCallbackQuery(query.id, {
                    text: "An error occurred while changing page.",
                    show_alert: true
                });
            } catch (callbackError) {
                logger.error('Failed to answer callback query:', callbackError);
            }
        }
    }
}

module.exports = PaginationUtils;