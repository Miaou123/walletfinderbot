const logger = require('../../utils/logger');
const { getSolanaApi } = require('../../integrations/solanaApi');
const { recognizeArgType, validateAndParseTimeFrame, validateAndParseMinAmountOrPercentage } = require('./helpers.js');
const { formatEarlyBuyersMessage, formatEarlyBuyersMessagePaginated, getPortValue } = require('../formatters/earlyBuyersFormatter');
const EarlyBuyersAnalyzer = require('../../analysis/earlyBuyersAnalyzer');
const PaginationUtils = require('../../utils/paginationUtils');

class EarlyBuyersHandler {
    constructor() {
        this.analyzer = new EarlyBuyersAnalyzer();
        this.solanaApi = getSolanaApi();
        this.COMMAND_NAME = 'earlybuyers';
        this.MAX_BUYERS_PER_PAGE = 5; // Set how many buyers to show per page
    }

    async handleCommand(bot, msg, args, messageThreadId) {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        logger.info(`Starting EarlyBuyers command for user ${msg.from.username}`);

        try {
            // Parse arguments
            let coinAddress, timeFrame, percentage, pumpFlag;

            args.forEach(arg => {
                const { type, value } = recognizeArgType(arg);
                switch (type) {
                    case 'solanaAddress':
                        coinAddress = value;
                        break;
                    case 'time':
                        timeFrame = value;
                        break;
                    case 'percentage':
                        percentage = value;
                        break;
                    case 'flag':
                        pumpFlag = value;
                        break;
                }
            });

            if (!coinAddress) {
                throw new Error("Please provide a valid coin address.");
            }

            // Validate and parse parameters
            const hours = validateAndParseTimeFrame(timeFrame || '1h', 0.25, 5, false);
            const tokenInfo = await this.solanaApi.getAsset(coinAddress, 'earlyBuyers');
            
            if (!tokenInfo) {
                throw new Error("Failed to fetch token information");
            }

            const { minPercentage } = validateAndParseMinAmountOrPercentage(
                percentage,
                tokenInfo.supply.total,
                tokenInfo.decimals,
                0.1,
                2,
                1
            );

            const analysisType = pumpFlag === 'pump' ? "Pumpfun" : 
                               pumpFlag === 'nopump' ? "Pumpfun excluded" : 
                               "Standard";

            // Send loading message
            const loadingMsg = await bot.sendMessage(chatId,
                `🔎 Analyzing early buyers for <b>${tokenInfo.symbol}</b>\n` +
                `⏳ Time frame: <b>${hours} hours</b>\n` +
                `📊 Minimum percentage: <b>${minPercentage}%</b>\n` +
                `🚩 Analysis type: <b>${analysisType}</b>`,
                { parse_mode: 'HTML', disable_web_page_preview: true, message_thread_id: messageThreadId }
            );      

            // Analyze early buyers
            const result = await this.analyzer.analyzeEarlyBuyers(
                coinAddress, 
                minPercentage,
                hours,
                tokenInfo,
                'earlyBuyers',
                pumpFlag || ''
            );

            if (!result?.earlyBuyers) {
                throw new Error("Invalid result from analyzeEarlyBuyers");
            }

            // Delete loading message
            try {
                await bot.deleteMessage(chatId, loadingMsg.message_id);
            } catch (error) {
                logger.warn('Failed to delete loading message:', error);
            }

            // Check if we have any results
            if (!result.earlyBuyers || result.earlyBuyers.length === 0) {
                await bot.sendMessage(chatId, 
                    "No early buyers found in the specified time frame.", 
                    { message_thread_id: messageThreadId }
                );
                return;
            }

            // Sort the early buyers by portfolio value (highest first)
            // Filter out buyers with portfolio value less than minimum and sort by portfolio value
            const MINIMUM_PORT_SIZE = 1000;
            const sortedBuyers = result.earlyBuyers
                .filter(buyer => getPortValue(buyer) >= MINIMUM_PORT_SIZE)
                .sort((a, b) => getPortValue(b) - getPortValue(a));

            // Store metadata about the query
            const metadata = {
                coinAddress,
                timeFrame: hours,
                minPercentage,
                pumpFlag,
                tokenInfo,
                analysisType
            };

            // For group chats, use chatId as the state ID, otherwise use userId
            const stateId = msg.chat.type === 'private' ? userId : chatId;

            // Store sorted results for pagination
            const paginationState = PaginationUtils.storePaginationData(
                stateId,
                this.COMMAND_NAME,
                sortedBuyers,
                metadata,
                this.MAX_BUYERS_PER_PAGE
            );

            // Get the first page of results
            const firstPageBuyers = PaginationUtils.getPageResults(
                sortedBuyers,
                0,
                this.MAX_BUYERS_PER_PAGE
            );

            // Format the first page message with pagination
            const formattedMessage = formatEarlyBuyersMessagePaginated(
                firstPageBuyers,
                tokenInfo,
                hours,
                coinAddress,
                pumpFlag,
                0, // current page
                paginationState.totalPages,
                sortedBuyers.length,
                this.MAX_BUYERS_PER_PAGE
            );

            // Create pagination keyboard
            const keyboard = PaginationUtils.createPaginationKeyboard(
                this.COMMAND_NAME,
                0,
                paginationState.totalPages
            );

            // Send paginated message
            await bot.sendMessage(chatId, 
                formattedMessage, 
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
            logger.error('Error in earlybuyers command:', error);
            await bot.sendMessage(chatId, 
                `Error: ${error.message}`,
                { message_thread_id: messageThreadId }
            );
        }
    }

    /**
     * Handle callback queries for pagination
     */
    async handleCallback(bot, query) {
        try {
            const userId = query.from.id;
            const chatId = query.message.chat.id;
            
            // For group chats, use chatId as the state ID
            const stateId = query.message.chat.type === 'private' ? userId : chatId;
            
            // Parse the callback data
            const parts = query.data.split(':');
            const command = parts[0];
            const action = parts[1];
            
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
                    pageParam: parts[2],
                    
                    // Provide format function that will be called with page results
                    formatFunction: (pageResults, metadata, page, totalPages, totalResults, itemsPerPage) => {
                        return formatEarlyBuyersMessagePaginated(
                            pageResults,
                            metadata.tokenInfo,
                            metadata.timeFrame,
                            metadata.coinAddress,
                            metadata.pumpFlag,
                            page,
                            totalPages,
                            totalResults,
                            itemsPerPage
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

module.exports = EarlyBuyersHandler;