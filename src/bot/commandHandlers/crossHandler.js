const logger = require('../../utils/logger');
const {
    validateAndFormatAddress,
    recognizeArgType
} = require('./helpers');
const { getSolanaApi } = require('../../integrations/solanaApi');
const crossAnalyzer = require('../../analysis/crossAnalyzer');
const { sendFormattedCrossAnalysisMessage } = require('../formatters/crossAnalysisFormatter');

class CrossHandler {
    constructor(userManager, accessControl) {
        this.userManager = userManager;
        this.accessControl = accessControl;
        this.DEFAULT_MIN_VALUE = 1000;
        this.analyzer = new crossAnalyzer();
        this.solanaApi = getSolanaApi();
    }

    async handleCommand(bot, msg, args, messageThreadId) {

        if (args.length < 2) {
            await bot.sendMessage(msg.chat.id, 
                "Please provide at least two valid addresses and optionally a minimum combined value.", 
                { message_thread_id: messageThreadId }
            );
            return;
        }

        const { contractAddresses, minValue } = this.parseArgs(args);

        if (contractAddresses.length < 2) {
            await bot.sendMessage(msg.chat.id, 
                "Please provide at least two valid addresses.", 
                { message_thread_id: messageThreadId }
            );
            return;
        }

        try {
            const statusMsg = await bot.sendMessage(msg.chat.id, 
                `Starting cross-analysis for ${contractAddresses.length} tokens with minimum combined value of $${minValue}...`, 
                { message_thread_id: messageThreadId }
            );

            const tokenDetails = await Promise.all(contractAddresses.map(async (addr) => {
                const { isValid, formattedAddress } = validateAndFormatAddress(addr, 'solana');
                if (isValid) {
                    return this.solanaApi.getAsset(formattedAddress, 'earlyBuyers');
                } else {
                    return getAsset(addr);
                }
            }));

            if (tokenDetails.some(detail => !detail)) {
                await bot.editMessageText("Error fetching token details. Ensure all addresses are valid.", {
                    chat_id: msg.chat.id,
                    message_id: statusMsg.message_id
                });
                return;
            }

            const relevantHolders = await this.analyzer.crossAnalyze(contractAddresses);

            if (!relevantHolders.length) {
                await bot.editMessageText("No relevant holders found matching the criteria.", {
                    chat_id: msg.chat.id,
                    message_id: statusMsg.message_id
                });
                return;
            }

            // Use the formatter to generate and send the response
            await sendFormattedCrossAnalysisMessage(bot, msg.chat.id, relevantHolders, contractAddresses, tokenDetails);

        } catch (error) {
            logger.error('Error in cross command:', error);
            await bot.sendMessage(msg.chat.id, 
                `An error occurred during analysis: ${error.message}`, 
                { message_thread_id: messageThreadId }
            );
        }
    }

    parseArgs(args) {
        const contractAddresses = [];
        let minValue = this.DEFAULT_MIN_VALUE;

        args.forEach(arg => {
            const recognized = recognizeArgType(arg);
            if (recognized.type === 'solanaAddress' || recognized.type === 'ethereumAddress') {
                const { isValid, formattedAddress } = validateAndFormatAddress(recognized.value, recognized.type === 'solanaAddress' ? 'solana' : 'ethereum');
                if (isValid) {
                    contractAddresses.push(formattedAddress);
                }
            } else if (!isNaN(Number(arg)) && contractAddresses.length >= 2) {
                minValue = parseFloat(arg);
            }
        });

        return { contractAddresses, minValue };
    }
}

module.exports = CrossHandler;
