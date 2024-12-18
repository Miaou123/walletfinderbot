const logger = require('../../utils/logger');
const { validateAndParseTimeFrame, validateAndParseMinAmountOrPercentage, recognizeArgType } = require('./helpers.js');
const ApiCallCounter = require('../../utils/ApiCallCounter');
const ActiveCommandsTracker = require('../commandsManager/activeCommandsTracker');
const { getSolanaApi } = require('../../integrations/solanaApi');
const { analyzeFreshRatio } = require('../../analysis/freshRatio');
const { formatFreshRatioMessage } = require('../formatters/freshRatioFormatter');

const DEFAULT_TIME_FRAME = '1h';
const DEFAULT_SUPPLY_PERCENTAGE = '0.005%';

class FreshRatioHandler {
    constructor(userManager, accessControl) {
        this.userManager = userManager;
        this.accessControl = accessControl;
        this.solanaApi = getSolanaApi();
        this.COMMAND_NAME = 'freshratio'; 
    }

    async handleCommand(bot, msg, args, messageThreadId) {
        const userId = msg.from.id;
        logger.info(`Starting FreshRatio command for user ${msg.from.username}`);

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

            let coinAddress, timeFrame, supplyPercentage;

            args.forEach(arg => {
                const { type, value } = recognizeArgType(arg);
                logger.debug(`Parsing argument: ${arg}, recognized as: ${type}`);
                switch (type) {
                    case 'solanaAddress':
                        coinAddress = value;
                        break;
                    case 'time':
                        timeFrame = value;
                        break;
                    case 'percentage':
                        supplyPercentage = value;
                        break;
                }
            });

            if (!coinAddress) {
                throw new Error("Please provide a valid coin address.");
            }

            if (!timeFrame) timeFrame = DEFAULT_TIME_FRAME;
            if (!supplyPercentage) supplyPercentage = DEFAULT_SUPPLY_PERCENTAGE;

            const tokenInfo = await this.solanaApi.getAsset(coinAddress, 'freshRatio', 'getAsset');
            if (!tokenInfo) throw new Error("Token not found");

            const hours = validateAndParseTimeFrame(timeFrame, 1, 168, true);
            const { minAmount, minPercentage } = validateAndParseMinAmountOrPercentage(
                supplyPercentage,
                tokenInfo.supply.total,
                tokenInfo.decimals,
                0.005,
                100,
                1
            );

            await bot.sendLongMessage(msg.chat.id,
                `🔍 Analyzing fresh wallets for <b>${tokenInfo.symbol}</b>\n` +
                `⏳ Time frame: <b>${hours} hours</b>\n` +
                `📊 Minimum buy: <b>${minPercentage}% of supply</b>`,
                { parse_mode: 'HTML', disable_web_page_preview: true, message_thread_id: messageThreadId }
            );

            const result = await analyzeFreshRatio(
                coinAddress,
                minAmount,
                hours,
                tokenInfo,
                'freshRatio'
            );

            const formattedMessage = await formatFreshRatioMessage(result, tokenInfo);

            await bot.sendLongMessage(msg.chat.id, formattedMessage,
                { parse_mode: 'HTML', disable_web_page_preview: true, message_thread_id: messageThreadId }
            );

        } catch (error) {
            logger.error('Error in FreshRatioHandler:', error);
            await bot.sendLongMessage(msg.chat.id,
                `An error occurred: ${error.message}`,
                { message_thread_id: messageThreadId }
            );
        } finally {
            ApiCallCounter.logApiCalls('freshRatio');
            this._finalizeCommand(userId);
        }
    }

    _finalizeCommand(userId) {
        logger.debug('FreshRatio command completed');
        ActiveCommandsTracker.removeCommand(userId, this.COMMAND_NAME);
    }
}

module.exports = FreshRatioHandler;