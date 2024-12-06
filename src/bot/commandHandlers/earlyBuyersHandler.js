// EarlyBuyersHandler.js
const logger = require('../../utils/logger');
const { getSolanaApi } = require('../../integrations/solanaApi');
const { formatEarlyBuyersMessage } = require('../formatters/earlyBuyersFormatter'); // Assurez-vous que ce chemin est correct.
const  ActiveCommandsTracker  = require('../commandsManager/activeCommandsTracker'); // Assurez-vous que ce chemin est correct.
const EarlyBuyersAnalyzer = require('../../analysis/earlyBuyersAnalyzer');



const validateAndParseTimeFrame = (timeFrame) => {
    if (!timeFrame) return 1;
    
    let value = parseFloat(timeFrame);
    let unit = timeFrame.replace(/[0-9.]/g, '').toLowerCase();
  
    if (unit === 'm' || unit === 'min') {
      value /= 60;
    }
  
    if (isNaN(value) || value < 0.25 || value > 5) {
      throw new Error("Invalid time frame. Please enter a number between 0.25 and 5 hours, or 15 and 300 minutes.");
    }
  
    return Math.round(value * 100) / 100;
  };
  
  const validateAndParseMinAmountOrPercentage = (input, totalSupply, decimals) => {
    if (!input) {
      return { minAmount: BigInt(Math.floor((totalSupply * 0.01) * Math.pow(10, decimals))), minPercentage: 1 };
    }
  
    const value = parseFloat(input.replace('%', ''));
  
    if (isNaN(value) || value < 0.1 || value > 2) {
      throw new Error("Invalid input. Please enter a percentage between 0.1% and 2%.");
    }
  
    const minPercentage = value;
    const minAmount = BigInt(Math.floor((totalSupply * minPercentage / 100) * Math.pow(10, decimals)));
  
    return { minAmount, minPercentage };
  };

class EarlyBuyersHandler {
    constructor(userManager, accessControl) {
        this.userManager = userManager;
        this.accessControl = accessControl;
        this.analyzer = new EarlyBuyersAnalyzer();
    }
    

    async handleCommand(bot, msg, args, messageThreadId) {
        const userId = msg.from.id;
        logger.info(`Starting EarlyBuyers command for user ${msg.from.username}`);

        try {
            let coinAddress, timeFrame, percentage, pumpFlag;

            const solanaApi = getSolanaApi();
            
            const recognizeArgType = (arg) => {
                const lowerArg = arg.toLowerCase();
                if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(arg)) {
                    return { type: 'address', value: arg };
                } else if (/^(\d+(\.\d+)?)(h|m|min)$/.test(lowerArg)) {
                    return { type: 'time', value: lowerArg };
                } else if (/^(\d+(\.\d+)?%?)$/.test(lowerArg)) {
                    return { type: 'percentage', value: lowerArg.endsWith('%') ? lowerArg : lowerArg + '%' };
                } else if (lowerArg === 'pump' || lowerArg === 'nopump') {
                    return { type: 'flag', value: lowerArg };
                }
                return { type: 'unknown', value: arg };
            };

            args.forEach(arg => {
                const { type, value } = recognizeArgType(arg);
                switch (type) {
                    case 'address':
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
                    default:
                        logger.warn(`Unknown argument type: ${arg}`);
                }
            });

            if (!coinAddress) {
                throw new Error("Please provide a valid coin address.");
            }

            const hours = timeFrame ? validateAndParseTimeFrame(timeFrame) : 1;
            if (hours === null) {
                throw new Error("Invalid time frame. Please enter a number between 0.25 and 5 hours, or 15 and 300 minutes.");
            }

            // Récupération des infos du token via DexScreener uniquement
            const tokenInfo = await solanaApi.getAsset(coinAddress, 'earlyBuyers');

            if (!tokenInfo) {
                throw new Error("Failed to fetch token information");
            }

            const { minPercentage } = validateAndParseMinAmountOrPercentage(percentage, tokenInfo.supply.total, tokenInfo.decimals);

            let analysisType = "Standard";
            if (pumpFlag === 'pump') analysisType = "Pumpfun";
            if (pumpFlag === 'nopump') analysisType = "Pumpfun excluded";

            await bot.sendLongMessage(
                msg.chat.id,
                `🔎 Analyzing early buyers for <b>${tokenInfo.symbol}</b>\n` +
                `⏳ Time frame: <b>${hours} hours</b>\n` +
                `📊 Minimum percentage: <b>${minPercentage}%</b>\n` +
                `🚩 Analysis type: <b>${analysisType}</b>`,
                { parse_mode: 'HTML', disable_web_page_preview: true, message_thread_id: messageThreadId }
            );      

            const result = await this.analyzer.analyzeEarlyBuyers(coinAddress, minPercentage, hours, tokenInfo, 'earlyBuyers', pumpFlag || '');

            if (!result || !result.earlyBuyers) {
                throw new Error("Invalid result from analyzeEarlyBuyers");
            }

            let formattedMessage = await formatEarlyBuyersMessage(result.earlyBuyers, tokenInfo, hours, coinAddress, pumpFlag);
            if (!formattedMessage || formattedMessage.length === 0) {
                formattedMessage = "No early buyers found or error in formatting the message.";
            }

            await bot.sendLongMessage(msg.chat.id, formattedMessage, { parse_mode: 'HTML', disable_web_page_preview: true, message_thread_id: messageThreadId });

        } catch (error) {
            logger.error(`Error in EarlyBuyersHandler handleCommand:`, error);
            let errorMessage = `An error occurred during early buyers analysis: ${error.message}.`;
            await bot.sendLongMessage(msg.chat.id, errorMessage, { message_thread_id: messageThreadId });
        } finally {
            logger.debug('EarlyBuyers command completed');
            ActiveCommandsTracker.removeCommand(userId, 'eb');
        }
    }
}

module.exports = EarlyBuyersHandler;
