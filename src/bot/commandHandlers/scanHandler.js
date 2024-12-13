const logger = require('../../utils/logger');
const { scanToken } = require('../../analysis/topHoldersScanner');
const { formatScanResult } = require('../formatters/scanResultFormatter');
const { validateTrackingData } = require('../utils/validators');
const ActiveCommandsTracker = require('../commandsManager/activeCommandsTracker');
const { lastAnalysisResults } = require('../storage/analysisStorage');

class ScanHandler {
    constructor(userManager, accessControl) {
        this.userManager = userManager;
        this.accessControl = accessControl;
    }

    async handleCommand(bot, msg, args, messageThreadId) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const username = msg.from.username;

        try {
            const { tokenAddress, numberOfHolders } = this._parseAndValidateArgs(args);
            
            if (isNaN(numberOfHolders) || numberOfHolders < 1 || numberOfHolders > 100) {
                await bot.sendLongMessage(
                    chatId, 
                    "Invalid number of holders. Please provide a number between 1 and 100.", 
                    { message_thread_id: messageThreadId }
                );
                return;
            }

            const scanResult = await this._performScan(tokenAddress, numberOfHolders);
            await this._sendFormattedResult(bot, chatId, tokenAddress, scanResult, messageThreadId);
            await this._saveTrackingData(chatId, scanResult, username);

        } catch (error) {
            logger.error('Error in handleScanCommand:', error);
            await bot.sendLongMessage(
                chatId, 
                `An error occurred during the token scan: ${error.message}`, 
                { message_thread_id: messageThreadId }
            );
        } finally {
            this._finalizeCommand(userId);
        }
    }

    _parseAndValidateArgs(args) {
        const [tokenAddress, numberOfHoldersStr] = args;
        const numberOfHolders = numberOfHoldersStr ? parseInt(numberOfHoldersStr) : 10;
        return { tokenAddress, numberOfHolders };
    }

    async _performScan(tokenAddress, numberOfHolders) {
        const scanResult = await scanToken(tokenAddress, numberOfHolders, true, 'scan');
        
        if (!scanResult || !scanResult.scanData) {
            throw new Error("Scan result is incomplete or invalid.");
        }

        return scanResult;
    }

    async _sendFormattedResult(bot, chatId, tokenAddress, scanResult, messageThreadId) {
        const formattedResult = formatScanResult(
            scanResult.scanData.tokenInfo,
            scanResult.scanData.filteredWallets,
            scanResult.scanData.totalSupplyControlled,
            scanResult.scanData.averagePortfolioValue,
            scanResult.scanData.notableAddresses,
            scanResult.scanData.tokenAddress
        );

        await bot.sendLongMessage(
            chatId,
            formattedResult,
            {
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Track Supply", callback_data: `track_${tokenAddress}` }]
                    ]
                },
                message_thread_id: messageThreadId
            }
        );
    }

    async _saveTrackingData(chatId, scanResult, username) {
        if (scanResult.trackingInfo) {
            const trackingData = {
                tokenAddress: scanResult.trackingInfo.tokenAddress,
                tokenInfo: {
                    symbol: scanResult.trackingInfo.tokenSymbol,
                    totalSupply: scanResult.trackingInfo.totalSupply,
                    decimals: scanResult.trackingInfo.decimals,
                },
                totalSupplyControlled: scanResult.trackingInfo.totalSupplyControlled,
                initialSupplyPercentage: scanResult.trackingInfo.totalSupplyControlled,
                topHoldersWallets: scanResult.trackingInfo.topHoldersWallets,
                teamWallets: [],
                analysisType: 'tokenScanner',
                trackType: 'topHolders',
                username: username
            };

            const validationResult = validateTrackingData(trackingData);
            if (!validationResult.isValid) {
                logger.warn(`Invalid tracking data: ${validationResult.message}`);
                throw new Error(`Invalid tracking data: ${validationResult.message}`);
            }

            lastAnalysisResults[chatId] = trackingData;

            logger.debug('Saved tracking data:', {
                chatId,
                tokenAddress: trackingData.tokenAddress,
                savedData: {
                    hasTokenInfo: !!trackingData.tokenInfo,
                    symbol: trackingData.tokenInfo.symbol,
                    totalSupply: trackingData.tokenInfo.totalSupply,
                    totalSupplyControlled: trackingData.totalSupplyControlled,
                    hasTopHolders: !!trackingData.topHoldersWallets,
                    numberOfHolders: trackingData.topHoldersWallets.length
                }
            });
        }
    }

    _finalizeCommand(userId) {
        ActiveCommandsTracker.removeCommand(userId, 'scan');
    }
}

module.exports = ScanHandler;