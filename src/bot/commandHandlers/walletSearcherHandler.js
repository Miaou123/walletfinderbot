const BaseHandler = require('./baseHandler');
const logger = require('../../utils/logger');
const WalletService = require('../../database/services/walletService');
const { formatNumber } = require('../formatters/generalFormatters');

/**
 * Handler for searching wallets based on various criteria
 * Provides an interactive interface for users to set search parameters
 */
class WalletSearcherHandler extends BaseHandler {
    constructor(accessControl) {
        super();
        logger.debug('Initializing WalletSearcherHandler', {
            accessControlProvided: Boolean(accessControl)
        });
        
        this.accessControl = accessControl;
        this.commandName = 'walletsearch';
        
        try {
            this.stateManager = require('../../utils/stateManager');
            logger.debug('StateManager imported successfully in WalletSearcherHandler');
        } catch (error) {
            logger.error('Error importing stateManager in WalletSearcherHandler:', error);
            this.stateManager = null;
        }
        
        // Default search criteria
        this.defaultCriteria = {
            winrate: 0,
            total_value: 0,
            realized_profit_30d: 0,
            sol_balance: 0
        };
        
        // Criteria options for UI
        this.criteriaOptions = {
            winrate: [0, 30, 50, 70, 90],
            total_value: [0, 5000, 10000, 50000, 100000],
            realized_profit_30d: [0, 1000, 5000, 10000, 50000],
            sol_balance: [0, 1, 5, 10, 50]
        };
        
        // Human-readable names for criteria
        this.criteriaNames = {
            winrate: 'Win Rate',
            total_value: 'Portfolio Value',
            realized_profit_30d: 'Profit (30d)',
            sol_balance: 'SOL Balance'
        };
        
        // Criteria units for display
        this.criteriaUnits = {
            winrate: '%',
            total_value: '$',
            realized_profit_30d: '$',
            sol_balance: 'SOL'
        };
        
        // Maximum results to return
        this.maxResults = 20;
        
        logger.info('WalletSearcherHandler initialized');
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
            
            logger.info(`WalletSearch command started by user ${username}`, {
                chatId,
                userId,
                messageThreadId,
                args
            });
            
            // Debug stateManager
            logger.debug('StateManager check in wallet searcher:', {
                stateManagerExists: Boolean(this.stateManager),
                stateManagerType: typeof this.stateManager,
                hasSetSessionDataMethod: this.stateManager && typeof this.stateManager.setSessionData === 'function'
            });
            
            // Debug accessControl
            logger.debug('AccessControl check in wallet searcher:', {
                accessControlExists: Boolean(this.accessControl),
                accessControlType: typeof this.accessControl,
                hasActiveSubscriptionMethod: this.accessControl && typeof this.accessControl.hasActiveSubscription === 'function',
                methods: this.accessControl ? Object.keys(this.accessControl) : []
            });
            
            // Check if user has subscription
            if (!this.accessControl || typeof this.accessControl.hasActiveSubscription !== 'function') {
                logger.error('AccessControl not properly initialized in WalletSearcherHandler', {
                    accessControlMethods: this.accessControl ? Object.keys(this.accessControl) : []
                });
                await this.sendMessage(
                    bot,
                    chatId,
                    "An error occurred. Please try again later.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }
            
            if (!await this.accessControl.hasActiveSubscription(userId)) {
                logger.info(`User ${username} denied access to wallet searcher - no subscription`);
                await this.sendMessage(
                    bot,
                    chatId,
                    "⭐ This command is only available to premium users. Use /subscribe to get access.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }
            
            // Initialize search state in stateManager
            const searchState = {
                criteria: { ...this.defaultCriteria },
                timestamp: new Date().getTime()
            };
            
            // Store in user session
            try {
                if (!this.stateManager || typeof this.stateManager.setSessionData !== 'function') {
                    throw new Error('StateManager not properly initialized');
                }
                
                this.stateManager.setSessionData(chatId, 'walletSearch', searchState);
                logger.debug('Search state saved successfully', { chatId, state: searchState });
            } catch (stateError) {
                logger.error('Error saving search state:', stateError);
                throw stateError;
            }
            
            // Send initial search panel
            logger.debug('Sending search panel', { chatId, criteria: searchState.criteria });
            await this.sendSearchPanel(bot, chatId, searchState.criteria, messageThreadId);
            logger.info('Wallet search panel sent successfully');
            
        } catch (error) {
            logger.error('Error in wallet search command:', error, {
                stack: error.stack,
                message: error.message
            });
            
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
            const [category, action, criteriaName, value, page] = query.data.split(':');
            
            logger.debug('Wallet search callback:', { action, criteriaName, value, page });
            
            // Get current search state
            const searchState = this.stateManager.getSessionData(chatId, 'walletSearch') || {
                criteria: { ...this.defaultCriteria },
                timestamp: new Date().getTime()
            };
            
            if (action === 'set') {
                // Set a criteria value
                if (criteriaName && value !== undefined) {
                    searchState.criteria[criteriaName] = parseFloat(value);
                    this.stateManager.setSessionData(chatId, 'walletSearch', searchState);
                    
                    // Update search panel
                    await this.updateSearchPanel(bot, query.message, searchState.criteria);
                }
            } else if (action === 'search') {
                // Execute search
                await this.executeSearch(bot, query.message, searchState.criteria);
            } else if (action === 'page') {
                // Handle pagination
                const pageNum = parseInt(page) || 0;
                await this.showResultsPage(bot, query.message, searchState.criteria, pageNum);
            } else if (action === 'back') {
                // Go back to search panel
                await this.updateSearchPanel(bot, query.message, searchState.criteria);
            } else if (action === 'reset') {
                // Reset criteria to defaults
                searchState.criteria = { ...this.defaultCriteria };
                this.stateManager.setSessionData(chatId, 'walletSearch', searchState);
                
                // Update search panel
                await this.updateSearchPanel(bot, query.message, searchState.criteria);
            }
            
            await bot.answerCallbackQuery(query.id);
        } catch (error) {
            logger.error('Error in wallet search callback:', error);
            await bot.answerCallbackQuery(query.id, {
                text: "An error occurred. Please try again.",
                show_alert: true
            });
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
        const message = this.formatSearchPanelMessage(criteria);
        const keyboard = this.createSearchPanelKeyboard(criteria);
        
        logger.debug('sendSearchPanel prepared data:', {
            messageLength: message.length,
            keyboardRows: keyboard.length,
            chatId
        });
        
        try {
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
            logger.debug('Search panel sent successfully');
        } catch (error) {
            logger.error('Error sending search panel:', error);
            throw error;
        }
    }

    /**
     * Update the search panel with new criteria
     * @param {Object} bot - The telegram bot instance
     * @param {Object} message - The message to update
     * @param {Object} criteria - Current search criteria
     */
    async updateSearchPanel(bot, message, criteria) {
        const chatId = message.chat.id;
        const messageId = message.message_id;
        const newMessage = this.formatSearchPanelMessage(criteria);
        const keyboard = this.createSearchPanelKeyboard(criteria);
        
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
     * Format the search panel message
     * @param {Object} criteria - Current search criteria
     * @returns {string} Formatted message
     */
    formatSearchPanelMessage(criteria) {
        let message = '<b>🔍 Wallet Search</b>\n\n';
        message += 'Set your search criteria and click Search to find wallets.\n\n';
        
        message += '<b>Current Criteria:</b>\n';
        
        for (const [key, value] of Object.entries(criteria)) {
            const name = this.criteriaNames[key] || key;
            const unit = this.criteriaUnits[key] || '';
            let displayValue = value;
            
            // Format percentages
            if (key === 'winrate') {
                displayValue = `${value}${unit}`;
            } 
            // Format dollar amounts
            else if (['total_value', 'realized_profit_30d'].includes(key)) {
                displayValue = `${unit}${formatNumber(value, 0)}`;
            }
            // Format SOL amounts
            else if (key === 'sol_balance') {
                displayValue = `${displayValue} ${unit}`;
            }
            
            message += `• <b>${name}:</b> ${displayValue}\n`;
        }
        
        return message;
    }

    /**
     * Create the search panel keyboard
     * @param {Object} criteria - Current search criteria
     * @returns {Array} Keyboard button rows
     */
    createSearchPanelKeyboard(criteria) {
        const keyboard = [];
        
        // Add buttons for each criteria
        for (const [key, values] of Object.entries(this.criteriaOptions)) {
            const row = [];
            const name = this.criteriaNames[key];
            
            row.push({
                text: `${name} ▼`,
                callback_data: this.generateCallbackData('none')
            });
            
            keyboard.push(row);
            
            // Add value buttons in a separate row
            const valueRow = [];
            for (const value of values) {
                // Mark the selected value
                const isSelected = criteria[key] === value;
                let display = value.toString();
                
                // Format display for percentages
                if (key === 'winrate') {
                    display = `${value}%`;
                } 
                // Format display for dollar amounts
                else if (['total_value', 'realized_profit_30d'].includes(key)) {
                    display = value === 0 ? 'Any' : `$${formatNumber(value, 0)}`;
                }
                // Format display for SOL amounts
                else if (key === 'sol_balance') {
                    display = value === 0 ? 'Any' : `${value} SOL`;
                }
                
                valueRow.push({
                    text: isSelected ? `✅ ${display}` : display,
                    callback_data: this.generateCallbackData('set', { criteria: key, value })
                });
            }
            keyboard.push(valueRow);
        }
        
        // Add control buttons
        const controlRow = [
            {
                text: "🔄 Reset",
                callback_data: this.generateCallbackData('reset')
            },
            {
                text: "🔍 Search",
                callback_data: this.generateCallbackData('search')
            }
        ];
        
        keyboard.push(controlRow);
        
        return keyboard;
    }

    /**
     * Execute search with current criteria
     * @param {Object} bot - The telegram bot instance
     * @param {Object} message - The message to update
     * @param {Object} criteria - Search criteria to use
     */
    async executeSearch(bot, message, criteria) {
        const chatId = message.chat.id;
        
        try {
            // Show loading message
            await bot.editMessageText(
                '<b>🔍 Searching wallets...</b>\n\nPlease wait while we find matches for your criteria.',
                {
                    chat_id: chatId,
                    message_id: message.message_id,
                    parse_mode: 'HTML'
                }
            );
            
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
            const searchState = this.stateManager.getSessionData(chatId, 'walletSearch') || {
                criteria: { ...criteria },
                timestamp: new Date().getTime()
            };
            
            searchState.results = results;
            this.stateManager.setSessionData(chatId, 'walletSearch', searchState);
            
            // Show first page of results
            await this.showResultsPage(bot, message, criteria, 0, results);
            
        } catch (error) {
            logger.error('Error executing wallet search:', error);
            await bot.editMessageText(
                '<b>❌ Search Error</b>\n\nAn error occurred while searching wallets. Please try again.',
                {
                    chat_id: chatId,
                    message_id: message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: "◀️ Back to Search",
                                callback_data: this.generateCallbackData('back')
                            }
                        ]]
                    }
                }
            );
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
            // sol_balance is stored as string, so we need to use $regex for comparison
            const solBalanceRegex = new RegExp(`^\\d*\\.?\\d*$`);
            query.sol_balance = { 
                $regex: solBalanceRegex, 
                $gte: criteria.sol_balance.toString() 
            };
        }
        
        return query;
    }

    /**
     * Show a page of search results
     * @param {Object} bot - The telegram bot instance
     * @param {Object} message - The message to update
     * @param {Object} criteria - Search criteria used
     * @param {number} page - Page number to show
     * @param {Array} results - Search results if already available
     */
    async showResultsPage(bot, message, criteria, page = 0, results = null) {
        const chatId = message.chat.id;
        
        try {
            // Get results from state if not provided
            if (!results) {
                const searchState = this.stateManager.getSessionData(chatId, 'walletSearch');
                if (!searchState || !searchState.results) {
                    throw new Error('No search results found');
                }
                results = searchState.results;
            }
            
            // Calculate pagination
            const totalResults = results.length;
            const totalPages = Math.ceil(totalResults / this.maxResults);
            const startIndex = page * this.maxResults;
            const endIndex = Math.min(startIndex + this.maxResults, totalResults);
            const pageResults = results.slice(startIndex, endIndex);
            
            // Format results message
            const message = this.formatResultsMessage(pageResults, criteria, page, totalPages, totalResults);
            
            // Create pagination keyboard
            const keyboard = this.createResultsPaginationKeyboard(page, totalPages);
            
            // Update message with results
            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: message.message_id,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: {
                    inline_keyboard: keyboard
                }
            });
            
        } catch (error) {
            logger.error('Error showing results page:', error);
            await bot.editMessageText(
                '<b>❌ Error</b>\n\nAn error occurred while displaying results. Please try again.',
                {
                    chat_id: chatId,
                    message_id: message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: "◀️ Back to Search",
                                callback_data: this.generateCallbackData('back')
                            }
                        ]]
                    }
                }
            );
        }
    }

    /**
     * Format search results message
     * @param {Array} results - Page of search results
     * @param {Object} criteria - Search criteria used
     * @param {number} page - Current page number
     * @param {number} totalPages - Total number of pages
     * @param {number} totalResults - Total number of results
     * @returns {string} Formatted message
     */
    formatResultsMessage(results, criteria, page, totalPages, totalResults) {
        if (results.length === 0) {
            return '<b>🔍 Wallet Search Results</b>\n\nNo wallets found matching your criteria. Try adjusting your search parameters.';
        }
        
        let message = '<b>🔍 Wallet Search Results</b>\n\n';
        
        // Show criteria used
        message += '<b>Search Criteria:</b>\n';
        for (const [key, value] of Object.entries(criteria)) {
            if (value > 0) {
                const name = this.criteriaNames[key] || key;
                const unit = this.criteriaUnits[key] || '';
                let displayValue = value;
                
                // Format percentages
                if (key === 'winrate') {
                    displayValue = `≥ ${value}${unit}`;
                } 
                // Format dollar amounts
                else if (['total_value', 'realized_profit_30d'].includes(key)) {
                    displayValue = `≥ ${unit}${formatNumber(value, 0)}`;
                }
                // Format SOL amounts
                else if (key === 'sol_balance') {
                    displayValue = `≥ ${displayValue} ${unit}`;
                }
                
                message += `• ${name}: ${displayValue}\n`;
            }
        }
        
        message += `\n<b>Found ${totalResults} wallets</b> (Showing ${page * this.maxResults + 1}-${Math.min((page + 1) * this.maxResults, totalResults)})\n\n`;
        
        // Format each result
        results.forEach((wallet, index) => {
            const position = page * this.maxResults + index + 1;
            const truncatedAddress = wallet.address.substring(0, 6) + '...' + wallet.address.substring(wallet.address.length - 4);
            
            message += `<b>${position}. <a href="https://solscan.io/account/${wallet.address}">${truncatedAddress}</a></b>\n`;
            
            // Portfolio value
            if (wallet.total_value !== null && wallet.total_value !== undefined) {
                message += `💼 Port: $${formatNumber(wallet.total_value, 0)}`;
            }
            
            // SOL balance
            if (wallet.sol_balance) {
                message += ` | ◎${formatNumber(parseFloat(wallet.sol_balance), 2)}`;
            }
            
            message += '\n';
            
            // Winrate
            if (wallet.winrate !== null && wallet.winrate !== undefined) {
                message += `📊 WR: ${(wallet.winrate * 100).toFixed(0)}%`;
            }
            
            // Profit
            if (wallet.realized_profit_30d) {
                message += ` | 💰 30d PnL: $${formatNumber(wallet.realized_profit_30d, 0)}`;
            }
            
            message += '\n\n';
        });
        
        // Add pagination info
        if (totalPages > 1) {
            message += `<i>Page ${page + 1} of ${totalPages}</i>`;
        }
        
        return message;
    }

    /**
     * Create pagination keyboard for results
     * @param {number} page - Current page number
     * @param {number} totalPages - Total number of pages
     * @returns {Array} Keyboard button rows
     */
    createResultsPaginationKeyboard(page, totalPages) {
        const keyboard = [];
        const navigationRow = [];
        
        // Add back button
        navigationRow.push({
            text: "◀️ Back to Search",
            callback_data: this.generateCallbackData('back')
        });
        
        // Add pagination buttons if there's more than one page
        if (totalPages > 1) {
            // Previous page button
            if (page > 0) {
                navigationRow.push({
                    text: "◀️ Previous",
                    callback_data: this.generateCallbackData('page', { page: page - 1 })
                });
            }
            
            // Next page button
            if (page < totalPages - 1) {
                navigationRow.push({
                    text: "Next ▶️",
                    callback_data: this.generateCallbackData('page', { page: page + 1 })
                });
            }
        }
        
        keyboard.push(navigationRow);
        return keyboard;
    }
}

module.exports = WalletSearcherHandler;