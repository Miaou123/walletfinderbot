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
        this.accessControl = accessControl;
        this.commandName = 'walletsearch';
        this.stateManager = require('../../utils/stateManager');
        // Get a reference to all command handlers
        this.commandHandlers = require('./commandHandlers');
        
        // Get bot username for command links
        this.botUsername = '';
        
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
            unrealized_pnl: 0
        };
        
        // Human-readable names for criteria
        this.criteriaNames = {
            winrate: 'Win Rate',
            total_value: 'Total Value',
            realized_profit_30d: 'PnL (30d)',
            sol_balance: 'SOL',
            avg_holding_peroid: 'Hold Time',
            buy_30d: 'Buys',
            sell_30d: 'Sells',
            pnl_2x_5x_num: '2x-5x',
            pnl_gt_5x_num: '5x+',
            token_avg_cost: 'Avg Buy',
            unrealized_pnl: 'uPnL'
        };
        
        // Criteria units for display
        this.criteriaUnits = {
            winrate: '%',
            total_value: '$',
            realized_profit_30d: '$',
            sol_balance: 'SOL',
            avg_holding_peroid: 'h',
            buy_30d: '',
            sell_30d: '',
            pnl_2x_5x_num: '',
            pnl_gt_5x_num: '',
            token_avg_cost: '$',
            unrealized_pnl: '$'
        };
        
        // Maximum results to return
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
            
            // NOTE: No access check needed here - it's handled by MessageHandler
            // based on the requiresAuth setting in commandConfigs.js
            
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
                    let unit = this.criteriaUnits[criteriaName] || '';
                    let inputRequest = `Please enter a minimum value for ${this.criteriaNames[criteriaName]}`;
                    
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
                // Handle pagination
                const pageNum = parseInt(page) || 0;
                await this.showResultsPage(bot, query.message, searchState.criteria, pageNum, userId);
            } else if (action === 'back') {
                // Go back to search panel
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
                    
                    // Format display based on unit
                    let displayValue;
                    if (unit === 'm') {
                        displayValue = `${value} minutes`;
                    } else if (unit === 'h') {
                        displayValue = `${value} hours`;
                    } else if (unit === 'd') {
                        displayValue = `${value} days`;
                    }
                    
                    await bot.sendMessage(
                        chatId, 
                        `✅ ${this.criteriaNames[criteriaName]} set to minimum ${displayValue}.`,
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
                await bot.sendMessage(chatId, `Invalid input. Please enter a positive number for ${this.criteriaNames[criteriaName]}.`);
                return true; // We handled this message
            }
            
            // Apply specific validations based on criteria type
            if (criteriaName === 'winrate' && value > 100) {
                await bot.sendMessage(chatId, "Winrate cannot exceed 100%. Please enter a value between 0 and 100.");
                return true;
            }
            
            // No special validation for unrealized_pnl since it's a dollar value now
            
            // Handle zero value as a reset
            if (value === 0) {
                searchState.criteria[criteriaName] = 0;
                await bot.sendMessage(
                    chatId, 
                    `${this.criteriaNames[criteriaName]} filter has been reset.`,
                    { parse_mode: 'HTML' }
                );
            } else {
                // Store the value
                searchState.criteria[criteriaName] = value;
                
                // Format confirmation message based on criteria type
                const unit = this.criteriaUnits[criteriaName] || '';
                let displayValue;
                
                if (criteriaName === 'winrate') {
                    displayValue = `${value}${unit}`;
                } else if (['total_value', 'realized_profit_30d', 'token_avg_cost', 'unrealized_pnl'].includes(criteriaName)) {
                    displayValue = `${unit}${formatNumber(value, 0)}`;
                } else if (criteriaName === 'sol_balance') {
                    displayValue = `${value} ${unit}`;
                } else {
                    displayValue = `${value}`;
                }
                
                await bot.sendMessage(
                    chatId, 
                    `✅ ${this.criteriaNames[criteriaName]} set to minimum ${displayValue}.`,
                    { parse_mode: 'HTML' }
                );
            }
            
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
                    await bot.editMessageText(
                        this.formatSearchPanelMessage(searchState.criteria),
                        {
                            chat_id: chatId,
                            message_id: searchState.messageId,
                            parse_mode: 'HTML',
                            reply_markup: {
                                inline_keyboard: this.createSearchPanelKeyboard(searchState.criteria)
                            }
                        }
                    );
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
        const message = this.formatSearchPanelMessage(criteria);
        const keyboard = this.createSearchPanelKeyboard(criteria);
        
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
        message += 'Set criteria and click Search to find matching wallets.\n\n';
        
        // Count active criteria
        let activeCriteriaCount = 0;
        Object.values(criteria).forEach(value => {
            if (value > 0) activeCriteriaCount++;
        });
        
        if (activeCriteriaCount > 0) {
            message += '<b>Current Criteria:</b>\n';
            
            // Group active criteria into pairs for compact display
            const activeCriteria = [];
            for (const [key, value] of Object.entries(criteria)) {
                if (value > 0) {
                    const name = this.criteriaNames[key] || key;
                    const unit = this.criteriaUnits[key] || '';
                    let displayValue = value;
                    
                    // Format values based on type
                    if (key === 'winrate') {
                        displayValue = `${displayValue}${unit}`;
                    } else if (['total_value', 'realized_profit_30d', 'token_avg_cost', 'unrealized_pnl'].includes(key)) {
                        displayValue = `${unit}${formatNumber(displayValue, 0, false, true)}`;
                    } else if (key === 'sol_balance') {
                        displayValue = `${displayValue} ${unit}`;
                    } else if (key === 'avg_holding_peroid') {
                        // Convert hours to appropriate format
                        if (value < 1) {
                            displayValue = `${Math.round(value * 60)}m`;
                        } else if (value >= 24) {
                            displayValue = `${(value / 24).toFixed(1)}d`;
                        } else {
                            const hours = Math.floor(value);
                            const minutes = Math.round((value - hours) * 60);
                            displayValue = minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
                        }
                    }
                    
                    activeCriteria.push({ key, name, displayValue });
                }
            }
            
            // Display criteria in two columns where possible
            for (let i = 0; i < activeCriteria.length; i += 2) {
                const first = activeCriteria[i];
                const second = i + 1 < activeCriteria.length ? activeCriteria[i + 1] : null;
                
                if (second) {
                    // Two criteria on one line
                    message += `• ${first.name}: ${first.displayValue} | ${second.name}: ${second.displayValue}\n`;
                } else {
                    // Just one criteria on the line
                    message += `• ${first.name}: ${first.displayValue}\n`;
                }
            }
        } else {
            message += '<b>No filters applied</b> (select criteria below)\n';
        }
        
        // Add compact examples section
        message += '\n<b>Example Searches:</b>\n';
        message += '• Win Rate + Total Value = Top performers\n';
        message += '• 5x+ + 2x-5x = Big winners\n';
        message += '• Low Hold Time + High Buys/Sells = Active traders\n';
        
        return message;
    }

    /**
     * Create the search panel keyboard with custom input option
     * @param {Object} criteria - Current search criteria
     * @returns {Array} Keyboard button rows
     */
    createSearchPanelKeyboard(criteria) {
        const keyboard = [];
        
        // Group criteria into pairs for side-by-side layout
        const criteriaPairs = [
            // Performance metrics row 1
            ["winrate", "realized_profit_30d"],
            // Performance metrics row 2
            ["unrealized_pnl", "total_value"],
            // Balance and basic trading stats
            ["sol_balance", "token_avg_cost"],
            // Activity metrics
            ["buy_30d", "sell_30d"],
            // Trading performance metrics
            ["pnl_2x_5x_num", "pnl_gt_5x_num"],
            // Time-based metrics
            ["avg_holding_peroid"]
        ];
        
        // Add "Wallet Search" header
        keyboard.push([
            {
                text: "🔍 Wallet Search",
                callback_data: this.generateCallbackData('none')
            }
        ]);
            
        // Add criteria pairs
        for (const pairKeys of criteriaPairs) {
            const buttonRow = [];
            
            // Process each key in the pair
            for (const key of pairKeys) {
                const name = this.criteriaNames[key] || key;
                const unit = this.criteriaUnits[key] || '';
                
                // Format the display of active criteria
                let displayText = name;
                
                if (criteria[key] > 0) {
                    // Format the value based on the type
                    let valueDisplay = '';
                    if (key === 'winrate') {
                        valueDisplay = `${criteria[key]}${unit}`;
                    } else if (['total_value', 'realized_profit_30d', 'token_avg_cost', 'unrealized_pnl'].includes(key)) {
                        valueDisplay = `${unit}${formatNumber(criteria[key], 0, false, false)}`;
                    } else if (key === 'sol_balance') {
                        valueDisplay = `${criteria[key]} ${unit}`;
                    } else if (key === 'avg_holding_peroid') {
                        // Format holding time appropriately
                        const value = criteria[key];
                        if (value < 1) {
                            valueDisplay = `${Math.round(value * 60)}m`;
                        } else if (value >= 24) {
                            valueDisplay = `${(value / 24).toFixed(1)}d`;
                        } else {
                            const hours = Math.floor(value);
                            const minutes = Math.round((value - hours) * 60);
                            valueDisplay = minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
                        }
                    } else {
                        valueDisplay = `${criteria[key]}`;
                    }
                    
                    displayText = `${name}: ${valueDisplay} ✅`;
                }
                
                // Add button to row
                buttonRow.push({
                    text: displayText,
                    callback_data: this.generateCallbackData('custom', { criteria: key })
                });
            }
            
            // Add the row of buttons
            keyboard.push(buttonRow);
        }
        
        // Add a separator
        keyboard.push([
            {
                text: "───────────",
                callback_data: this.generateCallbackData('none')
            }
        ]);
        
        // Add control buttons
        const controlRow = [
            {
                text: "🔄 Reset All",
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
            // We no longer need to store the original message ID since we're sending a new one
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
            
            // Send a new message with search results
            const resultsMessage = this.formatResultsMessage(
                results.slice(0, this.maxResults), 
                criteria, 
                0, 
                Math.ceil(results.length / this.maxResults), 
                results.length
            );
            
            const newMsg = await bot.sendMessage(chatId, resultsMessage, {
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: {
                    inline_keyboard: this.createResultsPaginationKeyboard(0, Math.ceil(results.length / this.maxResults))
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
        
        if (criteria.unrealized_pnl > 0) {
            // Now treat it as a dollar value, not a percentage
            query.unrealized_pnl = { $gte: criteria.unrealized_pnl };
        }
        
        return query;
    }

    /**
     * Show a page of search results
     * @param {Object} bot - The telegram bot instance
     * @param {Object} message - The message to update
     * @param {Object} criteria - Search criteria used
     * @param {number} page - Page number to show
     * @param {number|string} userId - User ID for state retrieval
     * @param {Array} results - Search results if already available
     */
    async showResultsPage(bot, message, criteria, page = 0, userId, results = null) {
        const chatId = message.chat.id;
        
        try {
            // Get user state to retrieve results
            const userState = this.stateManager.getUserState(userId);
            
            // Get results from state if not provided
            if (!results) {
                if (!userState || userState.context !== 'walletSearch' || !userState.data || !userState.data.results) {
                    throw new Error('No search results found');
                }
                results = userState.data.results;
            }
            
            // Calculate pagination
            const totalResults = results.length;
            const totalPages = Math.ceil(totalResults / this.maxResults);
            const startIndex = page * this.maxResults;
            const endIndex = Math.min(startIndex + this.maxResults, totalResults);
            const pageResults = results.slice(startIndex, endIndex);
            
            // Format results message
            const formattedMessage = this.formatResultsMessage(pageResults, criteria, page, totalPages, totalResults);
            
            // Create pagination keyboard
            const keyboard = this.createResultsPaginationKeyboard(page, totalPages);
            
            // Send a new message with the results
            const newMsg = await bot.sendMessage(chatId, formattedMessage, {
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: {
                    inline_keyboard: keyboard
                }
            });
            
            // Update the message ID in state for future reference
            if (userState && userState.context === 'walletSearch' && userState.data) {
                userState.data.messageId = newMsg.message_id;
                this.stateManager.setUserState(userId, userState);
            }
            
        } catch (error) {
            logger.error('Error showing results page:', error);
            
            // Send a new error message
            await bot.sendMessage(chatId, 
                '<b>❌ Error</b>\n\nAn error occurred while displaying results. Please try again.',
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
        let activeCriteriaCount = 0;
        for (const [key, value] of Object.entries(criteria)) {
            if (value > 0) {
                activeCriteriaCount++;
                const name = this.criteriaNames[key] || key;
                const unit = this.criteriaUnits[key] || '';
                let displayValue = value;
                
                // Format display value based on criteria type
                if (key === 'winrate') {
                    displayValue = `≥ ${value}${unit}`;
                } 
                // Format dollar amounts
                else if (['total_value', 'realized_profit_30d', 'token_avg_cost', 'unrealized_pnl'].includes(key)) {
                    displayValue = `≥ ${unit}${formatNumber(value, 0, false, true)}`;
                }
                // Format SOL amounts
                else if (key === 'sol_balance') {
                    displayValue = `≥ ${displayValue} ${unit}`;
                }
                // Format holding period
                else if (key === 'avg_holding_peroid') {
                    if (value < 1) {
                        displayValue = `≤ ${Math.round(value * 60)}m`;
                    } else if (value >= 24) {
                        displayValue = `≥ ${(value / 24).toFixed(1)}d`;
                    } else {
                        const hours = Math.floor(value);
                        const minutes = Math.round((value - hours) * 60);
                        displayValue = `≥ ${minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`}`;
                    }
                }
                
                message += `• ${name}: ${displayValue}\n`;
            }
        }
        
        if (activeCriteriaCount === 0) {
            message += `• No filters applied (showing all wallets)\n`;
        }
        
        message += `\n<b>Found ${totalResults} wallets</b> (Showing ${page * this.maxResults + 1}-${Math.min((page + 1) * this.maxResults, totalResults)})\n\n`;
        
        // Format each result
        results.forEach((wallet, index) => {
            const position = page * this.maxResults + index + 1;
            
            try {
                // Handle missing address
                if (!wallet.address) {
                    message += `<b>${position}. Invalid wallet data</b>\n\n`;
                    return;
                }
                
                // Format address
                const truncatedAddress = wallet.address.substring(0, 6) + '...' + wallet.address.substring(wallet.address.length - 4);
                message += `<b>${position}. <a href="https://solscan.io/account/${wallet.address}">${truncatedAddress}</a></b>`;
                
                // Add GMGN & Cielo links
                message += ` <a href="https://gmgn.ai/sol/address/${wallet.address}">GMGN</a>/<a href="https://app.cielo.finance/profile/${wallet.address}/pnl/tokens">Cielo</a>\n`;
                
                // Line 1: Portfolio, SOL & Win Rate
                const portfolioValue = wallet.total_value !== null && wallet.total_value !== undefined 
                    ? `💼 $${formatNumber(wallet.total_value, 0, false, true)}` : '';
                
                // Parse SOL balance
                let solBalance = '';
                if (wallet.sol_balance) {
                    try {
                        const solValue = typeof wallet.sol_balance === 'string' 
                            ? parseFloat(wallet.sol_balance) : wallet.sol_balance;
                            
                        if (!isNaN(solValue)) {
                            solBalance = `SOL: ${formatNumber(solValue, 1)}`;
                        }
                    } catch (e) {
                        logger.warn(`Failed to parse SOL balance: ${wallet.sol_balance}`, e);
                    }
                }
                
                // Win rate
                const winrateValue = wallet.winrate !== null && wallet.winrate !== undefined
                    ? `WR: ${typeof wallet.winrate === 'number' ? (wallet.winrate * 100).toFixed(0) : 'N/A'}%` 
                    : '';
                
                // Combine for first line
                let line1 = '';
                if (portfolioValue) line1 += portfolioValue;
                if (solBalance) line1 += line1 ? ` | ${solBalance}` : solBalance;
                if (winrateValue) line1 += line1 ? ` | ${winrateValue}` : winrateValue;
                
                if (line1) {
                    message += `├ ${line1}\n`;
                }
                
                // Line 2: PnL & Trading stats
                const pnl30d = wallet.realized_profit_30d
                    ? `💸 PnL: $${formatNumber(wallet.realized_profit_30d, 0, false, true)}` : '';
                
                const trades = (wallet.buy_30d !== null && wallet.sell_30d !== null)
                    ? `${wallet.buy_30d}B/${wallet.sell_30d}S` : '';
                
                // Holding time with minutes format for < 1h
                let holdingTime = '';
                if (wallet.avg_holding_peroid !== null && wallet.avg_holding_peroid !== undefined) {
                    const holdingSeconds = wallet.avg_holding_peroid;
                    const holdingMinutes = holdingSeconds / 60;
                    const holdingHours = holdingMinutes / 60;
                    
                    if (holdingHours < 1) {
                        // Format as minutes if less than 1 hour
                        holdingTime = `${Math.round(holdingMinutes)}min`;
                    } else if (holdingHours >= 24) {
                        // Format as days if 24+ hours
                        holdingTime = `${(holdingHours / 24).toFixed(1)}d`;
                    } else {
                        // Format as hours and minutes
                        const hours = Math.floor(holdingHours);
                        const minutes = Math.round((holdingHours - hours) * 60);
                        holdingTime = minutes > 0 ? `${hours}h${minutes}min` : `${hours}h`;
                    }
                }
                
                // Combine for second line
                let line2 = '';
                if (pnl30d) line2 += pnl30d;
                if (trades) line2 += line2 ? ` | 🔄 ${trades}` : `🔄 ${trades}`;
                if (holdingTime) line2 += line2 ? ` | ⏱️ ${holdingTime}` : `⏱️ ${holdingTime}`;
                
                if (line2) {
                    message += `├ ${line2}\n`;
                }
                
                // Line 3: Performance indicators
                let line3 = '';
                
                // 2x-5x & 5x+ trades
                if (wallet.pnl_2x_5x_num > 0 || wallet.pnl_gt_5x_num > 0) {
                    let tradeStats = '';
                    if (wallet.pnl_2x_5x_num > 0) tradeStats += `2x-5x: ${wallet.pnl_2x_5x_num}`;
                    if (wallet.pnl_gt_5x_num > 0) {
                        tradeStats += tradeStats ? ` | 5x+: ${wallet.pnl_gt_5x_num}` : `5x+: ${wallet.pnl_gt_5x_num}`;
                    }
                    line3 += tradeStats ? `🚀 ${tradeStats}` : '';
                }
                
                // Avg Buy & Unrealized PnL
                const avgBuy = wallet.token_avg_cost > 0 
                    ? `Avg Buy: $${formatNumber(wallet.token_avg_cost, 0, false, true)}` : '';
                    
                // Unrealized PnL if significant
                let unrealPnl = '';
                if (wallet.unrealized_pnl !== null && Math.abs(wallet.unrealized_pnl) > 0.05) {
                    const pnlPercent = (wallet.unrealized_pnl * 100).toFixed(0);
                    const pnlSymbol = wallet.unrealized_pnl > 0 ? '📈' : '📉';
                    unrealPnl = `${pnlSymbol} uPnL: $${formatNumber(wallet.unrealized_pnl, 0, false, true)}`;
                }
                
                // Add to line 3
                if (avgBuy) line3 += line3 ? ` | ${avgBuy}` : avgBuy;
                if (unrealPnl) line3 += line3 ? ` | ${unrealPnl}` : unrealPnl;
                
                if (line3) {
                    message += `└ ${line3}\n`;
                }
                
                // Use code formatting for clarity
                message += `📊 <b>Show Details:</b> <code>/wc ${wallet.address}</code>\n\n`;
                
            } catch (error) {
                logger.error(`Error formatting wallet at index ${index}:`, error);
                message += `<b>${position}. Error formatting wallet data</b>\n\n`;
            }
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