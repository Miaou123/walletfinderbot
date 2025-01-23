// helpHandler.js
const { getCommandHelp } = require('../commandsManager/commandParser');

class HelpHandler {
    constructor() {
        this.COMMAND_NAME = 'help';
    }

    async handleCommand(bot, msg, args, messageThreadId) {
        if (args.length === 0) {
            await this.sendGeneralHelp(bot, msg, messageThreadId);
        } else {
            await this.sendSpecificHelp(bot, msg, args[0], messageThreadId);
        }
    }

    async sendGeneralHelp(bot, msg, messageThreadId) {
        const generalHelpMessage = `
You can use "/help [command]", "[command] help" or "/[command]" for a full detail on how the command works.
For example "/help /eb", "/eb help" or "/eb" with no arguments will give you a full explanation on how the early buyers command works.

Available commands:

/start - Start the bot
/help - Show help
/access - Show beta access information
/ping - Check if bot is online
/scan (/s) - Scan a token for a top holders analysis
/bundle (/bd) - Analyze bundle
/freshratio (/fr) - Analyze the proportion of fresh wallets buying a token over a specific time frame.
/earlybuyers (/eb) - Analyze early buyers on a given timeframe
/besttraders (/bt) - Analyze the 100 best traders
/topholders (/th) - Analyze top holders
/cross (/c) - Find common holders between multiple tokens
/crossbt (/cbt) - Find common holders between the top traders of multiple tokens (realized and unrealized PnL)
/team (/t) - Analyze team supply with an homemade algorithm (works for fresh launches and CTOs)
/search (/sh) - Search for specific wallets with only a part of their address
/dp - Show if dexscreener is paid for a token, also shows adds/boosts.
/em - Show the entryMap for the top holders of a token.
/tracker - Show tracked supplies
/cancel - Cancel the current active command

For more information on how to use each command and how they work, please consult our <a href="https://smp-team.gitbook.io/noesis-bot">documentation</a>.

If you have any questions, want to report a bug, or have any suggestions on new features, feel free to DM @Rengon0x on Telegram or Twitter!

⚠️This bot is still in development phase and will probably be subject to many bugs/issues⚠️
`;
        await bot.sendLongMessage(msg.chat.id, generalHelpMessage, {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            message_thread_id: messageThreadId
        });
    }

    async sendSpecificHelp(bot, msg, command, messageThreadId) {
        const specificHelpMessage = getCommandHelp(command);
        await bot.sendLongMessage(msg.chat.id, specificHelpMessage, { message_thread_id: messageThreadId }, true);
    }
}

module.exports = HelpHandler;
