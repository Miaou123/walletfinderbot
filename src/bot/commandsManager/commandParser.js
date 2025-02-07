const { commandConfigs, adminCommandConfigs } = require('./commandConfigs');

const validateSolanaAddress = (address) => {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
};

class CommandParser {
    constructor(botUsername) {
        this.botUsername = botUsername?.toLowerCase();
    }

    getMainCommandName(inputCommand) {
        // Vérifie d'abord dans les commandes admin
        for (const [cmd, config] of Object.entries(adminCommandConfigs)) {
            if (cmd === inputCommand || config.aliases.includes(inputCommand)) {
                return { command: cmd, isAdmin: true };
            }
        }

        // Vérifie dans les commandes normales
        for (const [cmd, config] of Object.entries(commandConfigs)) {
            if (cmd === inputCommand || config.aliases.includes(inputCommand)) {
                return { command: cmd, isAdmin: false };
            }
        }

        return null;
    }

    parseCommand(text) {
        const parts = text.trim().split(/\s+/);
        let commandWithSlash = parts[0].toLowerCase();

        // Vérifie si la commande inclut une mention de bot et l'extrait
        if (commandWithSlash.includes('@')) {
            const [command, botName] = commandWithSlash.split('@');
            if (botName && botName.toLowerCase() !== this.botUsername) {
                return { command: null, args: [], isAdmin: false };
            }
            commandWithSlash = command;
        }

        let args = parts.slice(1);
        const rawCommand = commandWithSlash.startsWith('/') ? commandWithSlash.slice(1) : commandWithSlash;

        // Cas /help <command> ou /help /command
        if (rawCommand === 'help' && args.length > 0) {
            const potentialCommand = args[0].startsWith('/') ? args[0].slice(1) : args[0];
            const resolved = this.getMainCommandName(potentialCommand);
            if (resolved) {
                return { command: 'help', args: [resolved.command], isAdmin: false };
            }
            return { command: null, args: [], isAdmin: false };
        }

        // Cas suffixe 'help' ou '/help'
        if (args.length > 0) {
            const lastArg = args[args.length - 1].toLowerCase();
            if (lastArg === 'help' || lastArg === '/help') {
                args = args.slice(0, -1);
                const resolved = this.getMainCommandName(rawCommand);
                if (resolved) {
                    return { command: 'help', args: [resolved.command], isAdmin: false };
                }
                return { command: null, args: [], isAdmin: false };
            }
        }

        // Commande classique
        const resolved = this.getMainCommandName(rawCommand);
        if (resolved) {
            return { command: resolved.command, args, isAdmin: resolved.isAdmin };
        }

        return { command: null, args: [], isAdmin: false };
    }

    validateArgs(command, args, isAdmin = false) {
        const config = isAdmin ? adminCommandConfigs[command] : commandConfigs[command];
        if (!config) return ['Unknown command. Please use /help for a full list of commands.'];

        const errors = [];

        if (args.length < config.minArgs) {
            errors.push(`Too few arguments. ${this.getCommandHelp(command, isAdmin)}`);
        }

        if (args.length > config.maxArgs && config.maxArgs !== Infinity) {
            errors.push(`Too many arguments. ${this.getCommandHelp(command, isAdmin)}`);
        }

        // Validations spécifiques pour les commandes admin
        if (isAdmin) {
            switch (command) {
                case 'adduser':
                    if (args.length < 2) {
                        errors.push("Usage: /adduser [username] [type]\nTypes: normal, vip, admin");
                    } else if (!['normal', 'vip', 'admin'].includes(args[1].toLowerCase())) {
                        errors.push("Invalid user type. Use 'normal', 'vip', or 'admin'");
                    }
                    break;
                case 'addgroup':
                    if (args.length > 0 && !['normal', 'vip'].includes(args[0].toLowerCase())) {
                        errors.push("Invalid group type. Use 'normal' or 'vip'");
                    }
                    break;
            }
        }
        // Validations pour les commandes standards
        else if (['scan', 'bundle', 'bt', 'th', 'team', 'search', 'eb'].includes(command)) {
            if (args.length > 0 && !validateSolanaAddress(args[0])) {
                errors.push(`Invalid contract address format. Please provide a valid Solana address.\n\n${this.getCommandHelp(command)}`);
            }
        }

        return errors;
    }

    isAdminCommand(command) {
        return !!adminCommandConfigs[command];
    }
}

module.exports = CommandParser;