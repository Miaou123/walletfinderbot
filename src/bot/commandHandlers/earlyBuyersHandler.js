const logger = require('../../utils/logger');
const { getSolanaApi } = require('../../integrations/solanaApi');
const { recognizeArgType, validateAndParseTimeFrame, validateAndParseMinAmountOrPercentage } = require('./helpers.js');
const { formatEarlyBuyersMessage } = require('../formatters/earlyBuyersFormatter');
const ActiveCommandsTracker = require('../commandsManager/activeCommandsTracker');
const EarlyBuyersAnalyzer = require('../../analysis/earlyBuyersAnalyzer');

class EarlyBuyersHandler {
    constructor(userManager, accessControl) {
        this.userManager = userManager;
        this.accessControl = accessControl;
        this.analyzer = new EarlyBuyersAnalyzer();
        this.solanaApi = getSolanaApi();
        this.COMMAND_NAME = 'earlybuyers';
    }

    async handleCommand(bot, msg, args, messageThreadId) {
        const userId = msg.from.id;
        logger.info(`Starting EarlyBuyers command for user ${msg.from.username}`);

        try {
            // Vérifier si l'utilisateur peut exécuter une nouvelle commande
            if (!ActiveCommandsTracker.canAddCommand(userId, this.COMMAND_NAME)) {
                await bot.sendMessage(msg.chat.id,
                    "You already have 3 active commands. Please wait for them to complete.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }

            // Ajouter la commande au tracker
            if (!ActiveCommandsTracker.addCommand(userId, this.COMMAND_NAME)) {
                await bot.sendMessage(msg.chat.id,
                    "Unable to add a new command at this time.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }

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

            await bot.sendLongMessage(msg.chat.id,
                `🔎 Analyzing early buyers for <b>${tokenInfo.symbol}</b>\n` +
                `⏳ Time frame: <b>${hours} hours</b>\n` +
                `📊 Minimum percentage: <b>${minPercentage}%</b>\n` +
                `🚩 Analysis type: <b>${analysisType}</b>`,
                { parse_mode: 'HTML', disable_web_page_preview: true, message_thread_id: messageThreadId }
            );      

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

            const formattedMessage = await formatEarlyBuyersMessage(result.earlyBuyers, tokenInfo, hours, coinAddress, pumpFlag) 
                || "No early buyers found.";

            await bot.sendLongMessage(msg.chat.id, formattedMessage, 
                { parse_mode: 'HTML', disable_web_page_preview: true, message_thread_id: messageThreadId }
            );

        } catch (error) {
            logger.error('Error in EarlyBuyersHandler:', error);
            await bot.sendLongMessage(msg.chat.id, 
                `An error occurred: ${error.message}`,
                { message_thread_id: messageThreadId }
            );
        } finally {
            this._finalizeCommand(userId);
        }
    }

    _finalizeCommand(userId) {
        logger.debug('EarlyBuyers command completed');
        ActiveCommandsTracker.removeCommand(userId, this.COMMAND_NAME);
    }
}

module.exports = EarlyBuyersHandler;