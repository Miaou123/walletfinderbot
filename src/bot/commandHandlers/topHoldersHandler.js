const BaseHandler = require('./baseHandler');
const { formatAnalysisMessage } = require('../formatters/topHoldersFormatter');
const unifiedApi = require('../../integrations/unifiedApiClient');
const { checkInactivityPeriod } = require('../../tools/inactivityPeriod');
const BigNumber = require('bignumber.js');
const config = require('../../utils/config');

/**
 * Handler for the /topholders command
 * Analyzes top holders of a given token
 */
class TopHoldersHandler extends BaseHandler {
    constructor() {
        super();
        this.MAX_HOLDERS = 100;
        this.DEFAULT_HOLDERS = 20;
    }

    /**
     * Handle the topholders command
     * @param {Object} bot - The telegram bot instance
     * @param {Object} msg - The message object from Telegram
     * @param {Array} args - Command arguments [token_address, count?]
     * @param {number|undefined} messageThreadId - The message thread ID if applicable
     */
    async handleCommand(bot, msg, args, messageThreadId) {
        this.logger.info(`Starting TopHolders command for user ${msg.from.username}`);

        try {
            const [coinAddress, topHoldersCountStr] = args;

            if (!coinAddress) {
                await this.sendMessage(
                    bot,
                    msg.chat.id,
                    "Please provide a token address.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }

            const count = parseInt(topHoldersCountStr) || this.DEFAULT_HOLDERS;

            if (isNaN(count) || count < 1 || count > this.MAX_HOLDERS) {
                await this.sendMessage(
                    bot,
                    msg.chat.id,
                    "Invalid number of holders. Please provide a number between 1 and 100.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }

            // Send an initial loading message
            const loadingMessage = await this.sendMessage(
                bot,
                msg.chat.id,
                `⏳ Analyzing top ${count} holders for token ${coinAddress}...`,
                { message_thread_id: messageThreadId }
            );

            // Use the unified API to get token info and holders
            const [tokenInfo, tokenHolders] = await Promise.all([
                unifiedApi.getTokenInfo(coinAddress, 'topholders', 'command'),
                unifiedApi.getTokenHolders(coinAddress, count, 'topholders', 'command')
            ]);

            const analyzedWallets = await this.analyzeHolders(tokenHolders, tokenInfo);

            // Delete the loading message
            await bot.deleteMessage(msg.chat.id, loadingMessage.message_id);

            if (analyzedWallets.length === 0) {
                await this.sendMessage(
                    bot,
                    msg.chat.id,
                    "No wallets found for analysis.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }

            const { messages, errors } = formatAnalysisMessage(analyzedWallets, tokenInfo);

            for (const message of messages) {
                if (typeof message === 'string' && message.trim() !== '') {
                    await this.sendMessage(
                        bot, 
                        msg.chat.id, 
                        message,
                        {
                            parse_mode: 'HTML',
                            disable_web_page_preview: true,
                            message_thread_id: messageThreadId
                        }
                    );
                }
            }

        } catch (error) {
            this.logger.error('Error in topholders command:', error);
            await this.sendMessage(
                bot,
                msg.chat.id,
                "An error occurred while analyzing top holders. Please try again later.",
                { message_thread_id: messageThreadId }
            );
        }
    }

    /**
     * Analyze and categorize token holders
     * @param {Array} holders - List of token holders
     * @param {Object} tokenInfo - Token information
     * @returns {Promise<Array>} Analyzed and categorized holders
     */
    async analyzeHolders(holders, tokenInfo) {
        try {
            const analyzedHolders = [];

            for (const holder of holders) {
                try {
                    const { address, amount, uiAmount } = holder;
                    
                    // Determine if the wallet is interesting
                    const { isInteresting, category } = await this.determineWalletCategory(
                        address,
                        holder,
                        tokenInfo.address
                    );

                    // Calculate supply percentage
                    const tokenBalance = new BigNumber(uiAmount || 0);
                    const supplyPercentage = this.calculateSupplyPercentage(
                        tokenBalance, 
                        tokenInfo.totalSupply
                    );
                    
                    // Format wallet data
                    const solBalance = holder.solBalance || 'N/A';
                    const tokenValueUsd = (tokenInfo.priceUsd || 0) * uiAmount;
                    
                    const formattedInfo = `${tokenBalance.toFormat(0)} ${tokenInfo.symbol}, ${supplyPercentage}% of supply, $${tokenValueUsd.toFixed(2)} - ${solBalance} SOL`;

                    // Create the result object
                    analyzedHolders.push({
                        address,
                        isInteresting,
                        category,
                        stats: holder,
                        formattedInfo,
                        supplyPercentage,
                        tokenValueUsd,
                        tokenBalance: tokenBalance.toFormat(0),
                        tokenSymbol: tokenInfo.symbol,
                        solBalance
                    });
                } catch (error) {
                    this.logger.error(`Error analyzing holder ${holder.address}:`, error);
                }
            }

            return analyzedHolders;
        } catch (error) {
            this.logger.error('Error in analyzeHolders:', error);
            throw error;
        }
    }

    /**
     * Determine if a wallet is interesting based on various criteria
     * @param {string} address - Wallet address
     * @param {Object} holder - Holder data
     * @param {string} tokenAddress - Token address
     * @returns {Promise<Object>} Object with isInteresting and category flags
     */
    async determineWalletCategory(address, holder, tokenAddress) {
        // If wallet has high value, mark as interesting
        if (holder.totalValueUsd > config.HIGH_WALLET_VALUE_THRESHOLD) {
            return { isInteresting: true, category: 'High Value' };
        }

        // If wallet has low transaction count, mark as interesting
        if (holder.transactionCount < config.LOW_TRANSACTION_THRESHOLD) {
            return { isInteresting: true, category: 'Low Transactions' };
        }

        // Check inactivity period
        try {
            const inactivityCheck = await checkInactivityPeriod(
                address, 
                tokenAddress, 
                'topholders', 
                'checkInactivity'
            );
            
            if (inactivityCheck.isInactive) {
                holder.daysSinceLastRelevantSwap = inactivityCheck.daysSinceLastActivity;
                return { isInteresting: true, category: 'Inactive' };
            }
        } catch (error) {
            this.logger.warn(`Failed to check inactivity for ${address}:`, error);
        }

        // Check if this is a trader wallet (from GMGN data)
        if (holder.isTrader) {
            return { isInteresting: true, category: 'Trader' };
        }

        return { isInteresting: false, category: '' };
    }

    /**
     * Calculate what percentage of the total supply a wallet holds
     * @param {BigNumber} balance - Wallet's token balance
     * @param {number} totalSupply - Token's total supply
     * @returns {string} Percentage formatted to 2 decimal places
     */
    calculateSupplyPercentage(balance, totalSupply) {
        return totalSupply && !isNaN(totalSupply) && totalSupply > 0 
            ? balance.dividedBy(totalSupply).multipliedBy(100).toFixed(2) 
            : 'N/A';
    }
}

module.exports = TopHoldersHandler;