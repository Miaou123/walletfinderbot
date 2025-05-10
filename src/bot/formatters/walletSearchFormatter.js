/**
 * Formatter for wallet search results
 * Handles formatting of wallet search panels and result displays
 */
const { formatNumber } = require('./generalFormatters');
const logger = require('../../utils/logger');

class WalletSearchFormatter {
    constructor() {
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
            unrealized_profit: 'uPnL'
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
            unrealized_profit: '$'
        };
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
                    } else if (['total_value', 'realized_profit_30d', 'token_avg_cost', 'unrealized_profit'].includes(key)) {
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
     * @param {Function} callbackGenerator - Function to generate callback data
     * @returns {Array} Keyboard button rows
     */
    createSearchPanelKeyboard(criteria, callbackGenerator) {
        const keyboard = [];
        
        // Group criteria into pairs for side-by-side layout
        const criteriaPairs = [
            // Performance metrics row 1
            ["winrate", "realized_profit_30d"],
            // Performance metrics row 2
            ["unrealized_profit", "total_value"],
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
                callback_data: callbackGenerator('none')
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
                    } else if (['total_value', 'realized_profit_30d', 'token_avg_cost', 'unrealized_profit'].includes(key)) {
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
                    callback_data: callbackGenerator('custom', { criteria: key })
                });
            }
            
            // Add the row of buttons
            keyboard.push(buttonRow);
        }
        
        // Add a separator
        keyboard.push([
            {
                text: "───────────",
                callback_data: callbackGenerator('none')
            }
        ]);
        
        // Add control buttons
        const controlRow = [
            {
                text: "🔄 Reset All",
                callback_data: callbackGenerator('reset')
            },
            {
                text: "🔍 Search",
                callback_data: callbackGenerator('search')
            }
        ];
        
        keyboard.push(controlRow);
        
        return keyboard;
    }

    /**
 * Format search results message
 * @param {Array} results - Page of search results
 * @param {Object} criteria - Search criteria used
 * @param {number} page - Current page number
 * @param {number} totalPages - Total number of pages
 * @param {number} totalResults - Total number of results
 * @param {number} maxResults - Maximum results per page
 * @returns {string} Formatted message
 */
formatResultsMessage(results, criteria, page, totalPages, totalResults, maxResults) {
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
            else if (['total_value', 'realized_profit_30d', 'token_avg_cost', 'unrealized_profit'].includes(key)) {
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
    
    message += `\n<b>Found ${totalResults} wallets</b> (Showing ${page * maxResults + 1}-${Math.min((page + 1) * maxResults, totalResults)})\n\n`;
    
    // Format each result with full details
    results.forEach((wallet, index) => {
        const position = page * maxResults + index + 1;
        
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
                    const minutes = Math.round((value - hours) * 60);
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
            if (wallet.unrealized_profit !== null && wallet.unrealized_profit !== undefined) {
                const pnlSymbol = wallet.unrealized_profit > 0 ? '📈' : '📉';
                unrealPnl = `${pnlSymbol} uPnL: $${formatNumber(wallet.unrealized_profit, 0, false, true)}`;
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
     * Create a shorter version of the results message to avoid Telegram length limits
     * @param {Array} results - Page of search results
     * @param {Object} criteria - Search criteria used
     * @param {number} page - Current page number
     * @param {number} totalPages - Total number of pages
     * @param {number} totalResults - Total number of results
     * @param {number} maxResults - Maximum results per page
     * @returns {string} Truncated formatted message
     */
    createTruncatedResultsMessage(results, criteria, page, totalPages, totalResults, maxResults) {
        if (results.length === 0) {
            return '<b>🔍 Wallet Search Results</b>\n\nNo wallets found matching your criteria. Try adjusting your search parameters.';
        }
        
        let message = '<b>🔍 Wallet Search Results</b>\n\n';
        
        // Shorter criteria section
        message += '<b>Search Criteria:</b> ';
        const activeCriteria = [];
        for (const [key, value] of Object.entries(criteria)) {
            if (value > 0) {
                const name = this.criteriaNames[key] || key;
                const unit = this.criteriaUnits[key] || '';
                let displayValue = value;
                
                // Format based on criteria type (simplified)
                if (key === 'winrate') {
                    displayValue = `${value}${unit}`;
                } else if (['total_value', 'realized_profit_30d', 'token_avg_cost', 'unrealized_profit'].includes(key)) {
                    displayValue = `${unit}${formatNumber(value, 0)}`;
                } else if (key === 'sol_balance') {
                    displayValue = `${value}${unit}`;
                }
                
                activeCriteria.push(`${name}: ${displayValue}`);
            }
        }
        
        if (activeCriteria.length === 0) {
            message += 'None';
        } else {
            message += activeCriteria.join(', ');
        }
        
        message += `\n\n<b>Found ${totalResults} wallets</b> (Showing ${page * maxResults + 1}-${Math.min((page + 1) * maxResults, totalResults)})\n\n`;
        message += '<i>⚠️ Showing compact view due to message size limits</i>\n\n';
        
        // Show fewer details per wallet to save space
        const maxWalletsToShow = Math.min(results.length, 10); // Limit displayed wallets if needed
        for (let i = 0; i < maxWalletsToShow; i++) {
            const wallet = results[i];
            const position = page * maxResults + i + 1;
            
            try {
                // Skip invalid wallets
                if (!wallet.address) continue;
                
                // Format address (shorter format)
                const truncatedAddress = wallet.address.substring(0, 4) + '...' + wallet.address.substring(wallet.address.length - 4);
                message += `<b>${position}. <a href="https://solscan.io/account/${wallet.address}">${truncatedAddress}</a></b>`;
                
                // Combine key metrics on one line
                const metrics = [];
                
                // Add key metrics only
                if (wallet.total_value) {
                    metrics.push(`$${formatNumber(wallet.total_value, 0)}`);
                }
                
                if (wallet.winrate) {
                    metrics.push(`WR: ${(wallet.winrate * 100).toFixed(0)}%`);
                }
                
                if (wallet.realized_profit_30d) {
                    const prefix = wallet.realized_profit_30d >= 0 ? '+' : '';
                    metrics.push(`PnL: ${prefix}$${formatNumber(wallet.realized_profit_30d, 0)}`);
                }
                
                if (metrics.length > 0) {
                    message += ` | ${metrics.join(' | ')}`;
                }
                
                message += `\n`;
            } catch (error) {
                logger.warn(`Error formatting wallet at position ${position}:`, error);
                message += `<b>${position}. Error with wallet data</b>\n`;
            }
        }
        
        // If there are more results than shown
        if (results.length > maxWalletsToShow) {
            message += `\n<i>...and ${results.length - maxWalletsToShow} more wallets</i>\n`;
        }
        
        // Add pagination info
        message += `\n<i>Page ${page + 1} of ${totalPages}</i>`;
        
        return message;
    }

    /**
     * Create pagination keyboard for results
     * @param {number} page - Current page number
     * @param {number} totalPages - Total number of pages
     * @param {Function} callbackGenerator - Function to generate callback data
     * @returns {Array} Keyboard button rows
     */
    createResultsPaginationKeyboard(page, totalPages, callbackGenerator) {
        const keyboard = [];
        
        // Always include page indicator in its own row
        if (totalPages > 1) {
            keyboard.push([{
                text: `📄 Page ${page + 1} of ${totalPages}`,
                callback_data: callbackGenerator('none')
            }]);
        }
        
        // Add navigation row
        const navigationRow = [];
        
        // Add back button
        navigationRow.push({
            text: "◀️ Back to Search",
            callback_data: callbackGenerator('back')
        });
        
        // Add pagination buttons if there's more than one page
        if (totalPages > 1) {
            // Previous page button - always show but disable if on first page
            if (page > 0) {
                navigationRow.push({
                    text: "◀️ Previous",
                    callback_data: callbackGenerator('page', { page: page - 1 })
                });
            } else {
                navigationRow.push({
                    text: "◀️ -",
                    callback_data: callbackGenerator('none')
                });
            }
            
            // Next page button - always show but disable if on last page
            if (page < totalPages - 1) {
                navigationRow.push({
                    text: "Next ▶️",
                    callback_data: callbackGenerator('page', { page: page + 1 })
                });
            } else {
                navigationRow.push({
                    text: "- ▶️",
                    callback_data: callbackGenerator('none')
                });
            }
        }
        
        // Add navigation row
        keyboard.push(navigationRow);
        
        // Optional: Add quick jump buttons for large result sets
        if (totalPages > 3) {
            const jumpRow = [];
            
            // First page
            jumpRow.push({
                text: "1️⃣",
                callback_data: page === 0 ? callbackGenerator('none') : callbackGenerator('page', { page: 0 })
            });
            
            // Middle pages - show some contextual page numbers
            if (totalPages <= 5) {
                // For smaller page counts, show all pages
                for (let i = 1; i < totalPages - 1; i++) {
                    jumpRow.push({
                        text: `${i + 1}`,
                        callback_data: page === i ? callbackGenerator('none') : callbackGenerator('page', { page: i })
                    });
                }
            } else {
                // For larger page counts, show contextual pages
                let pagesShown = [];
                
                // Always show pages around current page
                for (let i = Math.max(1, page - 1); i <= Math.min(page + 1, totalPages - 2); i++) {
                    pagesShown.push(i);
                }
                
                // Fill with more pages if we can
                if (pagesShown.length < 3) {
                    if (pagesShown[0] > 1) {
                        pagesShown.unshift(pagesShown[0] - 1);
                    }
                    if (pagesShown[pagesShown.length - 1] < totalPages - 2) {
                        pagesShown.push(pagesShown[pagesShown.length - 1] + 1);
                    }
                }
                
                // Add the page buttons
                for (const i of pagesShown) {
                    jumpRow.push({
                        text: `${i + 1}`,
                        callback_data: page === i ? callbackGenerator('none') : callbackGenerator('page', { page: i })
                    });
                }
            }
            
            // Last page
            jumpRow.push({
                text: `${totalPages}`,
                callback_data: page === totalPages - 1 ? callbackGenerator('none') : callbackGenerator('page', { page: totalPages - 1 })
            });
            
            keyboard.push(jumpRow);
        }
        
        // Add new search button in its own row
        keyboard.push([{
            text: "🔍 New Search",
            callback_data: callbackGenerator('new')
        }]);
        
        return keyboard;
    }

    /**
     * Format a custom input confirmation message
     * @param {string} criteriaName - Name of the criteria
     * @param {number} value - Value set
     * @param {string} unit - Unit for the value
     * @param {string} displayFormat - Optional display format for the value
     * @returns {string} Formatted confirmation message
     */
    formatCustomInputConfirmation(criteriaName, value, unit, displayFormat = null) {
        if (value === 0) {
            return `${criteriaName} filter has been reset.`;
        }
        
        let displayValue;
        
        if (displayFormat === 'time') {
            // Format time values
            if (value < 1) {
                displayValue = `${Math.round(value * 60)} minutes`;
            } else if (value >= 24) {
                displayValue = `${(value / 24).toFixed(1)} days`;
            } else {
                const hours = Math.floor(value);
                const minutes = Math.round((value - hours) * 60);
                displayValue = minutes > 0 ? `${hours} hours ${minutes} minutes` : `${hours} hours`;
            }
        } else if (displayFormat === 'money') {
            // Format money values
            displayValue = `${unit}${formatNumber(value, 0)}`;
        } else if (displayFormat === 'percentage') {
            // Format percentage values
            displayValue = `${value}${unit}`;
        } else {
            // Default formatting
            displayValue = `${value}${unit ? ' ' + unit : ''}`;
        }
        
        return `✅ ${criteriaName} set to minimum ${displayValue}.`;
    }
}

module.exports = WalletSearchFormatter;