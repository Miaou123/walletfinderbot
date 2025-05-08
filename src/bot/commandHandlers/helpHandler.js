const { commandConfigs, adminCommandConfigs } = require('../commandsManager/commandConfigs');

class HelpHandler {
    constructor(commandParser) {
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

<b>Available commands:</b>

👋 Basic commands:
/start - Start the bot
/help - Show help
/ping - Check if bot is online
/preview - show a preview of all Advanced commands
/subscribe - Subscribe to Noesis
/referral - Check your referral link and add/change your rewards wallet

<b>🆓 Free commands:</b>
/scan (/s) - Scan a token for a top holders analysis (then click on Track supply to get notified when top holders buy/sell)
/bundle (/bd) - Analyze bundle
/walletchecker (/wc) - In depth analysis of a Solana wallet
/dexpaid (/dp) - Show if dexscreener is paid for a token, also shows adds/boosts.

<b>👁️ Advanced commands:</b>
/topholders (/th) - Analyze top holders
/dev - Analyze the dev of a pumpfun token
/team (/t) - Analyze team supply with an homemade algorithm (then click on Track Team wallets to get notified when they buy/sell).
/entrymap (/em) - Show the entryMap for the top holders of a token.
/freshratio (/fr) - Analyze the proportion of fresh wallets buying a token over a specific time frame.
/earlybuyers (/eb) - Analyze early buyers on a given timeframe
/besttraders (/bt) - Analyze the 100 best traders
/cross (/c) - Find common holders between multiple tokens
/crossbt (/cbt) - Find common holders between the top traders of multiple tokens (realized and unrealized PnL)
/search (/sh) - Search for specific wallets with only a part of their address
/walletsearch (/ws) - Search for wallets based on criteria like winrate and portfolio value
/tracker - Show tracked supplies

For more information on how to use each command and how they work, please consult our <a href="https://smp-team.gitbook.io/noesis-bot">documentation</a>.

If you have any questions, want to report a bug, or have any suggestions on new features, feel free to DM @Rengon0x on Telegram or Twitter!

`;
        await bot.sendLongMessage(msg.chat.id, generalHelpMessage, {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            message_thread_id: messageThreadId
        });
    }

    async sendSpecificHelp(bot, msg, command, messageThreadId) {
        const cleanCommand = command.startsWith('/') ? command.slice(1) : command;
        let config = commandConfigs[cleanCommand] || adminCommandConfigs[cleanCommand];
        
        if (!config) {
            await bot.sendMessage(msg.chat.id, 
                "Unknown command. Use /help to see available commands.", 
                { message_thread_id: messageThreadId }
            );
            return;
        }
        
        // If the command doesn't take arguments, execute it directly through message handler
        if (config.minArgs === 0 && cleanCommand !== 'help') {
            const handlers = require('./commandHandlers');
            // Find the handler in the command mapping
            const command = handlers.getCommandMapping()[cleanCommand];
            if (command && command.handler) {
                // Execute the command directly
                return await command.handler(bot, msg, [], msg.message_thread_id);
            }
        }
    
        const commandEmojis = {
            'scan': '🔍',
            'bundle': '📦',
            'walletchecker': '📊',
            'dexpaid': '💰',
            'topholders': '👥',
            'dev': '👨‍💻',
            'team': '👥',
            'entrymap': '📈',
            'freshratio': '📊',
            'earlybuyers': '⚡',
            'besttraders': '🏆',
            'cross': '🔄',
            'crossbt': '🔄',
            'search': '🔎',
            'tracker': '👁️',
            'walletsearch': '🔍',
            'subscribe': '💫',
            'subscribe_group': '👥',
            'referral': '🔗',
            'default': '🔹'
        };
    
        const emoji = commandEmojis[cleanCommand] || commandEmojis.default;
        
        let helpMessage = `<b>${emoji} ${config.description}</b>\n\n`;
        
        // Extraire les paramètres requis et optionnels du usage
        const params = config.usage.match(/\[(.*?)\](?:\(([^)]+)\))?\*?/g) || [];
        const requiredParams = params.filter(p => !p.includes('*')).map(p => p.match(/\[(.*?)\]/)[1]);
        const optionalParams = params.filter(p => p.includes('*')).map(p => {
            const paramName = p.match(/\[(.*?)\]/)[1];
            const defaultMatch = p.match(/\((.*?)\)/);
            return {
                name: paramName,
                default: defaultMatch ? defaultMatch[1] : null
            };
        });
    
        helpMessage += '<b>Usage:</b> ';
        if (config.aliases && config.aliases.length > 0) {
           helpMessage += `<code>/${config.aliases[0]}`; // Utiliser le shortcut
           requiredParams.forEach(param => {
               helpMessage += ` [${param}]`;
           });
           helpMessage += `</code> (or /${cleanCommand})\n\n`; // Ajouter la commande complète entre parenthèses
        } else {
           helpMessage += `<code>/${cleanCommand}`;
           requiredParams.forEach(param => {
               helpMessage += ` [${param}]`;
           });
           helpMessage += '</code>\n\n';
        }
    
        // Ajouter les paramètres optionnels s'il y en a
        if (optionalParams.length > 0) {
            helpMessage += `<b>📝 Optional Parameters:</b>\n`;
            optionalParams.forEach(param => {
                if (param.default) {
                    helpMessage += `• <code>${param.name}</code> - (default: ${param.default})\n`;
                } else {
                    helpMessage += `• <code>${param.name}</code>\n`;
                }
            });
        }
    
        // Ajouter l'exemple
        helpMessage += `\n<b>Example:</b> <code>/`;

        if (config.aliases && config.aliases.length > 0) {
            helpMessage += config.aliases[0];
        } else {
            helpMessage += cleanCommand;
        }
        
        // Ajouter les paramètres requis avec des valeurs d'exemple
        requiredParams.forEach(param => {
            if (param.includes('address')) {
                helpMessage += ` tokenAddress`;
            } else {
                helpMessage += ` [${param}]`;
            }
        });
        
        // Ajouter les paramètres optionnels avec leurs valeurs par défaut
        optionalParams.forEach(param => {
            if (param.default) { 
                helpMessage += ` ${param.default}`;
            }
        });
        
        helpMessage += `</code>\n`;
    
        // Ajouter les détails
        if (config.helpMessage) {
            helpMessage += `\n<b>ℹ️ Details:</b>\n${config.helpMessage}`;
        }
    
        await bot.sendLongMessage(msg.chat.id, helpMessage, { 
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            message_thread_id: messageThreadId 
        }, true);
    }
}

module.exports = HelpHandler;