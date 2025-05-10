const BaseHandler = require('./baseHandler');
const logger = require('../../utils/logger');
const WalletService = require('../../database/services/walletService');
const WalletSearchFormatter = require('../formatters/walletSearchFormatter');

/**
 * Handler for searching wallets based on various criteria
 * Provides an interactive interface for users to set search parameters
 */
class WalletSearcherHandler extends BaseHandler {
    constructor(accessControl) {
        super();
        this.accessControl = accessControl;
        this.commandName = 'walletsearch';
        this.stateManager = require('../../utils/stateManager');
        // Get a reference to all command handlers
        this.commandHandlers = require('./commandHandlers');
        
        // Get bot username for command links
        this.botUsername = '';
        
        // Create formatter instance
        this.formatter = new WalletSearchFormatter();
        
        // Default search criteria
        this.defaultCriteria = {
            winrate: 0,
            total_value: 0,
            realized_profit_30d: 0,
            sol_balance: 0,
            avg_holding_peroid: 0,
            buy_30d: 0,
            sell_30d: 0,
            pnl_2x_5x_num: 0,
            pnl_gt_5x_num: 0,
            token_avg_cost: 0,
            unrealized_profit: 0
        };
        
        // Maximum results to return per page
        this.maxResults = 20;
    }

    /**
     * Generate callback data for buttons
     * @param {string} action - Action to perform
     * @param {Object} params - Additional parameters
     * @returns {string} Formatted callback data
     */
    generateCallbackData(action, params = {}) {
        let callbackData = `walletsearch:${action}`;
        
        if (params.criteria) {
            callbackData += `:${params.criteria}`;
        }
        
        if (params.value !== undefined) {
            callbackData += `:${params.value}`;
        }
        
        if (params.page !== undefined) {
            callbackData += `:${params.page}`;
        }
        
        return callbackData;
    }

    /**
     * Handle the /walletsearch command
     * @param {Object} bot - The telegram bot instance
     * @param {Object} msg - The message object from Telegram
     * @param {Array} args - Command arguments
     * @param {number|undefined} messageThreadId - The message thread ID if applicable
     */
    async handleCommand(bot, msg, args, messageThreadId) {
        try {
            const chatId = msg.chat.id;
            const userId = msg.from.id;
            const username = msg.from.username || userId;
            
            // Get the bot username if we don't have it already
            if (!this.botUsername) {
                try {
                    const botInfo = await bot.getMe();
                    this.botUsername = botInfo.username;
                    logger.debug(`Bot username retrieved: ${this.botUsername}`);
                } catch (error) {
                    logger.warn('Failed to get bot username:', error);
                }
            }
            
            logger.info(`WalletSearch command started by user ${username}`);
            
            // Initialize search state in stateManager
            const searchState = {
                criteria: { ...this.defaultCriteria },
                timestamp: new Date().getTime()
            };
            
            // Store in user state
            this.stateManager.setUserState(userId, {
                context: 'walletSearch',
                data: searchState
            });
            
            // Send initial search panel
            await this.sendSearchPanel(bot, chatId, searchState.criteria, messageThreadId);
            
        } catch (error) {
            logger.error('Error in wallet search command:', error);
            await this.sendMessage(
                bot,
                msg.chat.id,
                "An error occurred while processing your request. Please try again later.",
                { message_thread_id: messageThreadId }
            );
        }
    }

    /**
     * Handle callback queries for this command
     * @param {Object} bot - The telegram bot instance
     * @param {Object} query - The callback query
     */
    async handleCallback(bot, query) {
        try {
            const chatId = query.message.chat.id;
            const userId = query.from.id;
            
            const [category, action, criteriaName, value, page] = query.data.split(':');
            
            logger.debug('Wallet search callback:', { action, criteriaName, value, page });
            
            // Get current search state from user state
            const userState = this.stateManager.getUserState(userId);
            let searchState = userState?.context === 'walletSearch' && userState.data
                ? userState.data
                : {
                    criteria: { ...this.defaultCriteria },
                    timestamp: new Date().getTime()
                };
            
            // Handle 'none' action - do nothing but acknowledge the query
            if (action === 'none') {
                await bot.answerCallbackQuery(query.id);
                return;
            }
            
            if (action === 'set') {
                // Set a criteria value
                if (criteriaName && value !== undefined) {
                    searchState.criteria[criteriaName] = parseFloat(value);
                    // Store message ID in state to help with message editing
                    searchState.messageId = query.message.message_id;
                    this.stateManager.setUserState(userId, {
                        context: 'walletSearch',
                        data: searchState
                    });
                    
                    // Update search panel
                    await this.updateSearchPanel(bot, query.message, searchState.criteria);
                }
            } else if (action === 'custom') {
                // In our new UI, clicking on a criteria directly goes to custom input
                // Handle custom input request
                if (criteriaName) {
                    // Store the message ID and criteria name for later
                    searchState.messageId = query.message.message_id;
                    searchState.pendingCriteria = criteriaName;
                    this.stateManager.setUserState(userId, {
                        context: 'walletSearch',
                        data: searchState
                    });
                    
                    // Determine what kind of input to ask for
                    let unit = this.formatter.criteriaUnits[criteriaName] || '';
                    let inputRequest = `Please enter a minimum value for ${this.formatter.criteriaNames[criteriaName]}`;
                    
                    if (criteriaName === 'winrate') {
                        inputRequest += ` (enter a number from 0-100)`;
                    } else if (criteriaName === 'avg_holding_peroid') {
                        inputRequest += ` (you can use format like "30m", "5h", or "2d")`;
                    } else {
                        inputRequest += ` (enter a number)`;
                    }
                    
                    // Ask for custom input
                    await bot.sendMessage(chatId, inputRequest);
                }
            } else if (action === 'search') {
                // Execute search
                await this.executeSearch(bot, query.message, searchState.criteria, userId);
            } else if (action === 'page') {
                // Handle pagination - use the message that triggered the callback
                const pageNum = parseInt(page) || 0;
                await this.showResultsPage(bot, query.message, searchState.criteria, pageNum, userId);
            } else if (action === 'back') {
                // Go back to search panel - try to edit current message
                try {
                    await this.updateSearchPanel(bot, query.message, searchState.criteria);
                } catch (error) {
                    // If we can't update the panel (maybe message was deleted), start a new one
                    if (error.message && error.message.includes('message to edit not found')) {
                        await this.sendSearchPanel(bot, chatId, searchState.criteria);
                    } else {
                        throw error;
                    }
                }
            } else if (action === 'reset') {
                // Reset criteria to defaults
                searchState.criteria = { ...this.defaultCriteria };
                searchState.messageId = query.message.message_id; // Store message ID
                this.stateManager.setUserState(userId, {
                    context: 'walletSearch',
                    data: searchState
                });
                
                // Update search panel
                await this.updateSearchPanel(bot, query.message, searchState.criteria);
            } else if (action === 'new') {
                // Start a completely new search
                searchState = {
                    criteria: { ...this.defaultCriteria },
                    timestamp: new Date().getTime()
                };
                this.stateManager.setUserState(userId, {
                    context: 'walletSearch',
                    data: searchState
                });
                
                await this.sendSearchPanel(bot, chatId, searchState.criteria);
            }
            
            // Always acknowledge callback query
            await bot.answerCallbackQuery(query.id);
        } catch (error) {
            logger.error('Error in wallet search callback:', error);
            try {
                await bot.answerCallbackQuery(query.id, {
                    text: "An error occurred. Please try again.",
                    show_alert: true
                });
                
                // If it's a serious error, offer to start a new search
                if (error.message && (
                    error.message.includes('not found') ||
                    error.message.includes('ETELEGRAM')
                )) {
                    await bot.sendMessage(query.message.chat.id, 
                        "There was an issue with your previous search. Would you like to start a new one?",
                        {
                            reply_markup: {
                                inline_keyboard: [[
                                    {
                                        text: "🔍 Start New Search",
                                        callback_data: this.generateCallbackData('new')
                                    }
                                ]]
                            }
                        }
                    );
                }
            } catch (answerError) {
                logger.error('Failed to answer callback query:', answerError);
            }
        }
    }

    /**
     * Handle custom input from user for criteria values
     * @param {Object} bot - The telegram bot instance
     * @param {Object} msg - The message object with the user input
     * @returns {boolean} Whether the message was handled
     */
    async handleCustomInput(bot, msg) {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        const inputText = msg.text.trim();
        
        try {
            // Get search state
            const userState = this.stateManager.getUserState(userId);
            if (!userState || userState.context !== 'walletSearch' || !userState.data || !userState.data.pendingCriteria) {
                // Not waiting for custom input, ignore
                return false;
            }
            
            const searchState = userState.data;
            const criteriaName = searchState.pendingCriteria;
            
            // Special handling for holding time with suffix
            if (criteriaName === 'avg_holding_peroid') {
                const timeRegex = /^(\d+\.?\d*)([mhd])?$/i;
                const match = inputText.match(timeRegex);
                
                if (match) {
                    const value = parseFloat(match[1]);
                    const unit = (match[2] || 'h').toLowerCase();
                    
                    if (isNaN(value) || value < 0) {
                        await bot.sendMessage(chatId, `Invalid time value. Please enter a positive number with optional unit (m, h, d).`);
                        return true;
                    }
                    
                    // Convert to hours based on unit
                    let valueInHours;
                    if (unit === 'm') {
                        valueInHours = value / 60;
                    } else if (unit === 'h') {
                        valueInHours = value;
                    } else if (unit === 'd') {
                        valueInHours = value * 24;
                    }
                    
                    // Store the value in hours
                    searchState.criteria[criteriaName] = valueInHours;
                    
                    // Get confirmation message from formatter
                    const confirmationMessage = this.formatter.formatCustomInputConfirmation(
                        this.formatter.criteriaNames[criteriaName],
                        valueInHours,
                        '',
                        'time'
                    );
                    
                    await bot.sendMessage(
                        chatId, 
                        confirmationMessage,
                        { parse_mode: 'HTML' }
                    );
                    
                    // Clear pending status
                    delete searchState.pendingCriteria;
                    
                    // Update user state
                    this.stateManager.setUserState(userId, {
                        context: 'walletSearch',
                        data: searchState
                    });
                    
                    // Update the search panel
                    await this.updateSearchPanel(bot, { chat_id: chatId, message_id: searchState.messageId }, searchState.criteria);
                    
                    return true;
                } else {
                    await bot.sendMessage(chatId, `Invalid format. Please use a number followed by an optional unit (m, h, d). Examples: 30m, 5h, 2d`);
                    return true;
                }
            }
            
            // Regular input parsing for other criteria
            let value = parseFloat(inputText.replace(/[$,%]/g, ''));
            
            if (isNaN(value) || value < 0) {
                await bot.sendMessage(chatId, `Invalid input. Please enter a positive number for ${this.formatter.criteriaNames[criteriaName]}.`);
                return true; // We handled this message
            }
            
            // Apply specific validations based on criteria type
            if (criteriaName === 'winrate' && value > 100) {
                await bot.sendMessage(chatId, "Winrate cannot exceed 100%. Please enter a value between 0 and 100.");
                return true;
            }
            
            // Store the value
            searchState.criteria[criteriaName] = value;
            
            // Determine display format for confirmation
            let displayFormat = null;
            if (criteriaName === 'winrate') {
                displayFormat = 'percentage';
            } else if (['total_value', 'realized_profit_30d', 'token_avg_cost', 'unrealized_profit'].includes(criteriaName)) {
                displayFormat = 'money';
            }
            
            // Get confirmation message from formatter
            const confirmationMessage = this.formatter.formatCustomInputConfirmation(
                this.formatter.criteriaNames[criteriaName],
                value,
                this.formatter.criteriaUnits[criteriaName] || '',
                displayFormat
            );
            
            await bot.sendMessage(
                chatId, 
                confirmationMessage,
                { parse_mode: 'HTML' }
            );
            
            // Clear pending status
            delete searchState.pendingCriteria;
            
            // Update user state
            this.stateManager.setUserState(userId, {
                context: 'walletSearch',
                data: searchState
            });
            
            // Update the search panel if we have a stored message ID
            if (searchState.messageId) {
                try {
                    await this.updateSearchPanel(bot, { chat_id: chatId, message_id: searchState.messageId }, searchState.criteria);
                } catch (error) {
                    // If we can't edit the message, send a new one
                    if (error.message && error.message.includes('message to edit not found')) {
                        await this.sendSearchPanel(bot, chatId, searchState.criteria);
                    } else {
                        throw error;
                    }
                }
            } else {
                // If we don't have a message ID, just send a new search panel
                await this.sendSearchPanel(bot, chatId, searchState.criteria);
            }
            
            return true; // We handled this message
        } catch (error) {
            logger.error('Error handling custom input:', error);
            await bot.sendMessage(
                chatId,
                "An error occurred while processing your input. Please try again."
            );
            return true; // We tried to handle it
        }
    }

    /**
     * Send the search panel with current criteria
     * @param {Object} bot - The telegram bot instance
     * @param {number|string} chatId - The chat ID
     * @param {Object} criteria - Current search criteria
     * @param {number|undefined} messageThreadId - The message thread ID if applicable
     */
    async sendSearchPanel(bot, chatId, criteria, messageThreadId) {
        const message = this.formatter.formatSearchPanelMessage(criteria);
        const keyboard = this.formatter.createSearchPanelKeyboard(criteria, (action, params = {}) => {
            return this.generateCallbackData(action, params);
        });
        
        await this.sendMessage(
            bot,
            chatId,
            message,
            {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: keyboard
                },
                message_thread_id: messageThreadId
            }
        );
    }

    /**
     * Update the search panel with new criteria
     * @param {Object} bot - The telegram bot instance
     * @param {Object} message - The message to update
     * @param {Object} criteria - Current search criteria
     */
    async updateSearchPanel(bot, message, criteria) {
        const chatId = message.chat_id || message.chat.id;
        const messageId = message.message_id;
        const newMessage = this.formatter.formatSearchPanelMessage(criteria);
        const keyboard = this.formatter.createSearchPanelKeyboard(criteria, (action, params = {}) => {
            return this.generateCallbackData(action, params);
        });
        
        await bot.editMessageText(newMessage, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: keyboard
            }
        });
    }

    /**
     * Execute search with current criteria
     * @param {Object} bot - The telegram bot instance
     * @param {Object} message - The message to update
     * @param {Object} criteria - Search criteria to use
     * @param {number|string} userId - User ID for state storage
     */
    async executeSearch(bot, message, criteria, userId) {
        const chatId = message.chat.id;
        
        try {
            // Send a new loading message instead of editing
            const loadingMsg = await bot.sendMessage(
                chatId,
                '<b>🔍 Searching wallets...</b>\n\nPlease wait while we find matches for your criteria.',
                { parse_mode: 'HTML' }
            );
            
            // Store the new message ID for potential future reference
            const loadingMessageId = loadingMsg.message_id;
            
            // Convert criteria to MongoDB query format
            const query = this.buildQuery(criteria);
            
            // Execute search
            const startTime = Date.now();
            const results = await WalletService.getWalletsByCriteria(query);
            const endTime = Date.now();
            const searchTime = (endTime - startTime) / 1000;
            
            logger.info(`Wallet search executed: ${results.length} results found in ${searchTime}s`, {
                criteria: query,
                resultCount: results.length
            });
            
            // Store results in state for pagination
            const userState = this.stateManager.getUserState(userId);
            const searchState = (userState?.context === 'walletSearch' && userState.data)
                ? userState.data
                : {
                    criteria: { ...criteria },
                    timestamp: new Date().getTime()
                };
            
            searchState.results = results;
            searchState.currentPage = 0; // Start at first page
            this.stateManager.setUserState(userId, {
                context: 'walletSearch',
                data: searchState
            });
            
            // Try to delete the loading message first
            try {
                await bot.deleteMessage(chatId, loadingMessageId);
            } catch (deleteError) {
                logger.warn('Could not delete loading message, it may have been deleted already', deleteError);
            }
            
            // Calculate the first page data
            const totalPages = Math.ceil(results.length / this.maxResults);
            const firstPageResults = results.slice(0, this.maxResults);
            
            // Format the message
            let resultsMessage = this.formatter.formatResultsMessage(
                firstPageResults, 
                criteria, 
                0, 
                totalPages, 
                results.length,
                this.maxResults
            );
            
            // Check if message is too long
            if (resultsMessage.length > 3800) {
                resultsMessage = this.formatter.createTruncatedResultsMessage(
                    firstPageResults,
                    criteria,
                    0,
                    totalPages,
                    results.length,
                    this.maxResults
                );
            }
            
            // Create keyboard
            const keyboard = this.formatter.createResultsPaginationKeyboard(0, totalPages, (action, params = {}) => {
                return this.generateCallbackData(action, params);
            });
            
            // Send a new message with search results
            const newMsg = await bot.sendMessage(chatId, resultsMessage, {
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: {
                    inline_keyboard: keyboard
                }
            });
            
            // Store the new message ID in state for pagination
            searchState.messageId = newMsg.message_id;
            this.stateManager.setUserState(userId, {
                context: 'walletSearch',
                data: searchState
            });
        } catch (error) {
            logger.error('Error executing wallet search:', error);
            
            // Send a new error message
            await bot.sendMessage(chatId, 
                '<b>❌ Search Error</b>\n\nAn error occurred while searching wallets. Please try again.',
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: "◀️ Back to Search",
                                callback_data: this.generateCallbackData('back')
                            },
                            {
                                text: "🔍 Start New Search",
                                callback_data: this.generateCallbackData('new')
                            }
                        ]]
                    }
                }
            );
        }
    }

    /**
     * Show a page of search results
     * @param {Object} bot - The telegram bot instance
     * @param {Object} message - The message to update
     * @param {Object} criteria - Search criteria used
     * @param {number} page - Page number to show
     * @param {number|string} userId - User ID for state retrieval
     */
    async showResultsPage(bot, message, criteria, page = 0, userId) {
        const chatId = message.chat.id;
        const messageId = message.message_id;
        
        try {
            // Get user state to retrieve results
            const userState = this.stateManager.getUserState(userId);
            
            if (!userState || userState.context !== 'walletSearch' || !userState.data || !userState.data.results) {
                throw new Error('No search results found');
            }
            
            const results = userState.data.results;
            
            // Calculate pagination
            const totalResults = results.length;
            const totalPages = Math.ceil(totalResults / this.maxResults);
            const startIndex = page * this.maxResults;
            const endIndex = Math.min(startIndex + this.maxResults, totalResults);
            const pageResults = results.slice(startIndex, endIndex);
            
            // Format results message
            let formattedMessage = this.formatter.formatResultsMessage(
                pageResults, 
                criteria, 
                page, 
                totalPages, 
                totalResults,
                this.maxResults
            );
            
            // Check message length to avoid Telegram error
            if (formattedMessage.length > 3800) { // Leave some buffer
                // If too long, reduce content and add a warning
                formattedMessage = this.formatter.createTruncatedResultsMessage(
                    pageResults, 
                    criteria, 
                    page, 
                    totalPages, 
                    totalResults,
                    this.maxResults
                );
            }
            
            // Create pagination keyboard
            const keyboard = this.formatter.createResultsPaginationKeyboard(page, totalPages, (action, params = {}) => {
                return this.generateCallbackData(action, params);
            });
            
            // Update existing message with the new page content
            await bot.editMessageText(formattedMessage, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: {
                    inline_keyboard: keyboard
                }
            });
            
            // Store current page in user state for context
            userState.data.currentPage = page;
            this.stateManager.setUserState(userId, userState);
            
        } catch (error) {
            logger.error('Error showing results page:', error);
            
            // If we can't edit (message might be too old), send a new one
            try {
                await bot.sendMessage(chatId, 
                    '<b>❌ Error</b>\n\nCannot update results. Starting a new results page.',
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [[
                                {
                                    text: "◀️ Back to Search",
                                    callback_data: this.generateCallbackData('back')
                                },
                                {
                                    text: "🔍 Start New Search",
                                    callback_data: this.generateCallbackData('new')
                                }
                            ]]
                        }
                    }
                );
                
                // If we have results, try sending a new results message
                const userState = this.stateManager.getUserState(userId);
                if (userState?.context === 'walletSearch' && userState.data?.results) {
                    const results = userState.data.results;
                    const totalPages = Math.ceil(results.length / this.maxResults);
                    
                    if (page >= totalPages) page = 0; // Reset page if out of range
                    
                    const startIndex = page * this.maxResults;
                    const endIndex = Math.min(startIndex + this.maxResults, results.length);
                    const pageResults = results.slice(startIndex, endIndex);
                    
                    // Format the message
                    let formattedMessage = this.formatter.formatResultsMessage(
                        pageResults, 
                        criteria, 
                        page, 
                        totalPages, 
                        results.length,
                        this.maxResults
                    );
                    
                    // Check if message is too long
                    if (formattedMessage.length > 3800) {
                        formattedMessage = this.formatter.createTruncatedResultsMessage(
                            pageResults,
                            criteria,
                            page,
                            totalPages,
                            results.length,
                            this.maxResults
                        );
                    }
                    
                    // Create keyboard
                    const keyboard = this.formatter.createResultsPaginationKeyboard(page, totalPages, (action, params = {}) => {
                        return this.generateCallbackData(action, params);
                    });
                    
                    // Send a new message with the updated results
                    const newMsg = await bot.sendMessage(chatId, formattedMessage, {
                        parse_mode: 'HTML',
                        disable_web_page_preview: true,
                        reply_markup: {
                            inline_keyboard: keyboard
                        }
                    });
                    
                    // Update message ID in state for future pagination
                    userState.data.messageId = newMsg.message_id;
                    userState.data.currentPage = page;
                    this.stateManager.setUserState(userId, userState);
                }
            } catch (sendError) {
                logger.error('Failed to send new message after pagination error:', sendError);
            }
        }
    }

    /**
     * Build MongoDB query from criteria
     * @param {Object} criteria - Search criteria
     * @returns {Object} MongoDB query
     */
    buildQuery(criteria) {
        const query = {};
        
        if (criteria.winrate > 0) {
            query.winrate = { $gte: criteria.winrate / 100 }; // Convert to decimal for DB
        }
        
        if (criteria.total_value > 0) {
            query.total_value = { $gte: criteria.total_value };
        }
        
        if (criteria.realized_profit_30d > 0) {
            query.realized_profit_30d = { $gte: criteria.realized_profit_30d };
        }
        
        if (criteria.sol_balance > 0) {
            try {
                // sol_balance could be stored as string or number, handle both cases
                const solBalanceValue = criteria.sol_balance.toString();
                
                // For numeric comparison
                query.$or = [
                    // For numeric fields
                    { sol_balance: { $gte: parseFloat(solBalanceValue) } },
                    // For string fields that can be parsed as numbers
                    { 
                        sol_balance: { 
                            $exists: true,
                            $ne: null,
                            $not: { $type: 'object' },
                            $regex: /^[0-9]*\.?[0-9]+$/ 
                        } 
                    }
                ];
                
                // Additional filter to apply after fetching
                query.$where = function() {
                    if (this.sol_balance === undefined || this.sol_balance === null) return false;
                    if (typeof this.sol_balance === 'number') return this.sol_balance >= criteria.sol_balance;
                    if (typeof this.sol_balance === 'string') {
                        const num = parseFloat(this.sol_balance);
                        return !isNaN(num) && num >= criteria.sol_balance;
                    }
                    return false;
                };
            } catch (error) {
                logger.error('Error building sol_balance query:', error);
                // Fallback to simple numeric comparison
                query.sol_balance = { $gte: criteria.sol_balance };
            }
        }
        
        // Add all criteria
        if (criteria.avg_holding_peroid > 0) {
            // Convert hours to seconds for comparison (avg_holding_peroid is stored in seconds)
            const holdingPeriodSeconds = criteria.avg_holding_peroid * 3600;
            query.avg_holding_peroid = { $gte: holdingPeriodSeconds };
        }
        
        if (criteria.buy_30d > 0) {
            query.buy_30d = { $gte: criteria.buy_30d };
        }
        
        if (criteria.sell_30d > 0) {
            query.sell_30d = { $gte: criteria.sell_30d };
        }
        
        if (criteria.pnl_2x_5x_num > 0) {
            query.pnl_2x_5x_num = { $gte: criteria.pnl_2x_5x_num };
        }
        
        if (criteria.pnl_gt_5x_num > 0) {
            query.pnl_gt_5x_num = { $gte: criteria.pnl_gt_5x_num };
        }
        
        if (criteria.token_avg_cost > 0) {
            query.token_avg_cost = { $gte: criteria.token_avg_cost };
        }
        
        if (criteria.unrealized_profit > 0) {
            // Use unrealized_profit as a dollar value
            query.unrealized_profit = { $gte: criteria.unrealized_profit };
        }
        
        return query;
    }
}

module.exports = WalletSearcherHandler;