const logger = require('../../utils/logger');
const TokenAnalyzer = require('../../analysis/topHoldersAnalyzer');
const { formatAnalysisMessage } = require('../formatters/topHoldersFormatter');
const { RequestCache, cachedCommand } = require('../../utils/requestCache');

class TopHoldersHandler {
    constructor() {
        this.tokenAnalyzer = new TokenAnalyzer();
        this.MAX_HOLDERS = 100;
        this.DEFAULT_HOLDERS = 20;
        this.cache = new RequestCache(5 * 60 * 1000);
        this.COMMAND_NAME = 'topholders';
    }

    async handleCommand(bot, msg, args, messageThreadId) {
        logger.info(`Starting TopHolders command for user ${msg.from.username}`);

        try {

            const [coinAddress, topHoldersCountStr] = args;

            if (!coinAddress) {
                await bot.sendLongMessage(
                    msg.chat.id,
                    "Please provide a token address.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }

            const count = parseInt(topHoldersCountStr) || this.DEFAULT_HOLDERS;

            if (isNaN(count) || count < 1 || count > this.MAX_HOLDERS) {
                await bot.sendLongMessage(
                    msg.chat.id,
                    "Invalid number of holders. Please provide a number between 1 and 100.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }

            // Construction de la clé pour le cache
            const cacheParams = { coinAddress, count };

            // Fonction de fetch si le résultat n'est pas trouvé dans le cache
            const fetchFunction = async () => {
                return await this.tokenAnalyzer.analyzeToken(
                    coinAddress,
                    count,
                    'Analyze'
                );
            };

            // Récupération depuis le cache ou fetch si absent
            const { tokenInfo, analyzedWallets } = await cachedCommand(
                this.cache,
                '/th',
                cacheParams,
                fetchFunction
            );

            if (analyzedWallets.length === 0) {
                await bot.sendLongMessage(
                    msg.chat.id,
                    "No wallets found for analysis.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }

            const { messages, errors } = formatAnalysisMessage(analyzedWallets, tokenInfo);

            for (const message of messages) {
                if (typeof message === 'string' && message.trim() !== '') {
                    await bot.sendLongMessage(msg.chat.id, message, {
                        parse_mode: 'HTML',
                        disable_web_page_preview: true,
                        message_thread_id: messageThreadId
                    });
                }
            }

        } catch (error) {
            logger.error('Error in topholders command:', error);
            throw error;
        }
    }
}

module.exports = TopHoldersHandler;