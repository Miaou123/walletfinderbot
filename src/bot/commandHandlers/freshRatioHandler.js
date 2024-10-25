const logger = require('../../utils/logger');
const { validateAndParseTimeFrame, validateAndParseMinAmountOrPercentage } = require('./utilityFn.js');
const { ApiCallCounter } = require('../../utils/ApiCallCounter.js');
const { ActiveCommandsTracker } = require('../commandsManager/activeCommandsTracker.js');
const gmgnApi = require('../../integrations/gmgnApi');
const { analyzeFreshRatio } = require('../../analysis/freshRatio');
const { formatFreshRatioMessage } = require('../formatters/freshRatioFormatter');

// Valeurs par défaut
const DEFAULT_TIME_FRAME = '1h';
const DEFAULT_SUPPLY_PERCENTAGE = '0.005%';

class FreshRatioHandler {
    constructor(userManager, accessControl) {
        this.userManager = userManager;
        this.accessControl = accessControl;
    }

    async handleCommand(bot, msg, args, messageThreadId) {
        const userId = msg.from.id;
        logger.info(`Starting FreshRatio command for user ${msg.from.username}`);

        try {
            let coinAddress, timeFrame, supplyPercentage;
            
            const recognizeArgType = (arg) => {
                const lowerArg = arg.toLowerCase();
                if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(arg)) {
                    return { type: 'address', value: arg };
                } else if (/^(\d+(\.\d+)?)(h|m|min|d|day|days)$/.test(lowerArg)) {  // Modifié ici
                    return { type: 'time', value: lowerArg };
                } else if (/^(\d+(\.\d+)?%?)$/.test(lowerArg)) {
                    return { type: 'percentage', value: lowerArg.endsWith('%') ? lowerArg : lowerArg + '%' };
                }
                return { type: 'unknown', value: arg };
            };

            args.forEach(arg => {
                const { type, value } = recognizeArgType(arg);
                logger.debug(`Parsing argument: ${arg}, recognized as: ${type}`);
                switch (type) {
                    case 'address':
                        coinAddress = value;
                        logger.debug(`Set coinAddress: ${value}`);
                        break;
                    case 'time':
                        timeFrame = value;
                        logger.debug(`Set timeFrame: ${value}`);
                        break;
                    case 'percentage':
                        supplyPercentage = value;
                        logger.debug(`Set supplyPercentage: ${value}`);
                        break;
                    default:
                        logger.warn(`Unknown argument type: ${arg}`);
                }
            });

            // Appliquer les valeurs par défaut si non fournies
            if (!timeFrame) {
                timeFrame = DEFAULT_TIME_FRAME;
                logger.debug(`Using default timeFrame: ${timeFrame}`);
            }

            if (!supplyPercentage) {
                supplyPercentage = DEFAULT_SUPPLY_PERCENTAGE;
                logger.debug(`Using default supplyPercentage: ${supplyPercentage}`);
            }

            logger.debug(`Fetching token info for address: ${coinAddress}`);
            const tokenInfoResponse = await gmgnApi.getTokenInfo(coinAddress, 'freshRatio');
            logger.debug(`Token info response received: ${JSON.stringify(tokenInfoResponse.data.token)}`);

            const tokenInfo = tokenInfoResponse.data.token;

            logger.debug(`Validating timeFrame: ${timeFrame}`);
            const hours = validateAndParseTimeFrame(timeFrame);
            logger.debug(`Parsed hours: ${hours}`);

            logger.debug(`Validating supplyPercentage: ${supplyPercentage}`);
            const { minAmount, minPercentage } = validateAndParseMinAmountOrPercentage(
                supplyPercentage, 
                tokenInfo.total_supply,
                tokenInfo.decimals
            );
            logger.debug(`Calculated minAmount: ${minAmount}, minPercentage: ${minPercentage}`);

            const adjustedMinAmount = Number(minAmount) / Math.pow(10, tokenInfo.decimals);
            logger.debug(`Adjusted minAmount for API: ${adjustedMinAmount}`);

            logger.debug('Starting fresh ratio analysis');

            await bot.sendLongMessage(
                msg.chat.id,
                `🔍 Analyzing fresh wallets for <b>${tokenInfo.symbol}</b>\n` +
                `⏳ Time frame: <b>${hours} hours</b>\n` +
                `📊 Minimum buy: <b>${minPercentage}% of supply</b>`,
                { parse_mode: 'HTML', disable_web_page_preview: true, message_thread_id: messageThreadId }
            );

            const result = await analyzeFreshRatio(
                coinAddress,
                adjustedMinAmount,
                hours,
                tokenInfo,
                'freshRatio'
            );
            logger.debug(`Analysis result received: ${JSON.stringify(result)}`);

            logger.debug('Formatting message');
            let formattedMessage = await formatFreshRatioMessage(result, tokenInfo);
            logger.debug(`Message formatted, length: ${formattedMessage?.length}`);

            logger.debug('Sending final message');
            await bot.sendLongMessage(
                msg.chat.id,
                formattedMessage,
                { parse_mode: 'HTML', disable_web_page_preview: true, message_thread_id: messageThreadId }
            );

        } catch (error) {
            logger.error(`Error in FreshRatioHandler:`, error);
            logger.debug(`Error stack: ${error.stack}`);
            let errorMessage = `An error occurred during fresh ratio analysis: ${error.message}`;
            await bot.sendLongMessage(msg.chat.id, errorMessage, { message_thread_id: messageThreadId });
        } finally {
            logger.debug(`Cleaning up command for user ${userId}`);
            try {
                ApiCallCounter.logApiCalls('freshRatio');
            } catch (error) {
                logger.error('Error logging API calls:', error);
            }
            ActiveCommandsTracker.removeCommand(userId, 'freshratio');
        }
    }
}

module.exports = FreshRatioHandler;