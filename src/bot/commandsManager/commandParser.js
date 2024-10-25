const validateSolanaAddress = (address) => {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  };

  const commandConfigs = {
    'start': { 
      aliases: [], 
      minArgs: 0, 
      maxArgs: 0, 
      requiresAuth: false, 
      description: 'Start the bot', 
      dailyLimit: Infinity,
      usage: '/start',
      helpMessage: ''
    },
    'help': { 
      aliases: [], 
      minArgs: 0, 
      maxArgs: 0, 
      requiresAuth: false, 
      description: 'Show help information', 
      dailyLimit: Infinity,
      usage: '/help',
      helpMessage: ''
    },
    'ping': { 
      aliases: [], 
      minArgs: 0, 
      maxArgs: 0, 
      requiresAuth: false, 
      description: 'Check bot responsiveness', 
      dailyLimit: Infinity,
      usage: '/ping',
      helpMessage: ''
    },
    'scan': { 
      aliases: ['s'], 
      minArgs: 1, 
      maxArgs: 2, 
      requiresAuth: false, 
      description: 'Scan a token for top holders', 
      dailyLimit: 10,
      usage: '/scan [contract_address] [number_of_top_holders](10)*',
      helpMessage: 'Scan a token for a top holders breakdown.\n\nTip: Increasing the number of top holders analyzed is recommended for a better overview on high mcap tokens (max: 100).'
    },
    'bundle': { 
      aliases: ['bd'], 
      minArgs: 1, 
      maxArgs: 1, 
      requiresAuth: false, 
      description: 'Analyze bundled trades', 
      dailyLimit: Infinity,
      usage: '/bundle [contract_address]',
      helpMessage: 'Analyze bundled trades for a specific contract address (Raydium, Meteora and pumpfun supported).'
    },
    'bt': { 
      aliases: ['besttraders'], 
      minArgs: 1, 
      maxArgs: 4, 
      requiresAuth: true, 
      description: 'Analyze best traders', 
      dailyLimit: 5,
      usage: '/bt [contract_address] [winrate_threshold](50%)* [portfolio_threshold]($10000)* [sort_option](port)*',
      helpMessage: 'Analyse the 100 best traders for a specific contract with given winrate and portfolio thresholds.\n\nSort options:\n- winrate/wr: Sort by win rate\n- pnl: Sort by profit and loss\n- portfolio/port: Sort by portfolio value\n- sol: Sort by SOL balance'
    },
    'th': { 
      aliases: ['topholders'], 
      minArgs: 1, 
      maxArgs: 2, 
      requiresAuth: true, 
      description: 'Analyze top holders', 
      dailyLimit: 5,
      usage: '/th [contract_address] [number_of_holders](20)*',
      helpMessage: 'Analyze the top holders of a specific coin. You can analyze up to 100 top holders.\n\nTip: Increasing the number of top holders analyzed is recommended for a better overview on high market cap tokens.'
    },
    'cross': { 
      aliases: ['c'], 
      minArgs: 2, 
      maxArgs: 6, 
      requiresAuth: true, 
      description: 'Cross-analyze multiple tokens', 
      dailyLimit: 20,
      usage: '/cross [contract_address1] [contract_address2] ... [Combined_value_min]($10000)*',
      helpMessage: 'Search for wallets that hold multiple coins. You can analyze up to 5 coins with a minimum combined value (default is $10000).\n\nThis command helps identify wallets that have significant holdings across multiple tokens.'
    },
    'crossbt': { 
      aliases: ['cbt'], 
      minArgs: 2, 
      maxArgs: 3, 
      requiresAuth: true, 
      description: 'Cross-analyze top traders of multiple tokens', 
      dailyLimit: 20,
      usage: '/crossbt [contract_address1] [contract_address2] [contract_address3]*',
      helpMessage: 'Analyze and compare the top 100 traders across 2 or 3 tokens to find common wallets. This command will help you find the best traders across a meta or wallets from team/insiders involved in multiple coins. You can analyze up to 3 coins.'
    },
    'team': { 
      aliases: ['t'], 
      minArgs: 1, 
      maxArgs: 1, 
      requiresAuth: true, 
      description: 'Analyze team supply', 
      dailyLimit: 5,
      usage: '/team [contract_address]',
      helpMessage: 'Analyze team and insider supply for a token using a custom algorithm.\n\nThis command helps identify wallets likely associated with the project team or insiders and estimates the total supply they control.'
    },
    'search': { 
      aliases: ['sh'], 
      minArgs: 2, 
      maxArgs: Infinity, 
      requiresAuth: true, 
      description: 'Search for specific wallets', 
      dailyLimit: 5,
      usage: '/search [contract_address] [partial_address1] [partial_address2]*',
      helpMessage: 'Search for wallets that hold a specific token and match the partial addresses provided.\n\nTip: You can add multiple parts to one partial address by separating them with one or multiple dots.'
    },
    'eb': { 
      aliases: ['earlybuyers'], 
      minArgs: 1, 
      maxArgs: 4, 
      requiresAuth: true, 
      description: 'Analyze early buyers', 
      dailyLimit: 5,
      usage: '/eb [coin_address] [time_frame](1h)* [percentage](1%)* [pump or nopump]*',
      helpMessage: 'Analyze early buyers of a specific coin within a given time frame and percentage threshold.\n\nTime frame is in hours or minutes (e.g., 2h or 30m). Percentage is the minimum percentage of total supply bought in one or multiple transactions over the timeframe.If you only want to analyse pumpfun transactions, use the flag "pump" at the end of your command and if you only want to analyse raydium transactions use "nopump"'
    },
    'freshratio': {
    aliases: ['fr'],
    minArgs: 1,
    maxArgs: 3,
    requiresAuth: true,
    description: 'Analyze fresh wallet ratio',
    dailyLimit: 10,
    usage: '/freshratio [contract_address] [time_frame](1h)* [percentage](0.1%)*',
    helpMessage: 'Analyze the proportion of fresh wallets buying a token over a specific time frame.\n\n' +
                 'Time frame is in hours or minutes (e.g., 1h or 30m). Default is 1 hour.\n' +
                 'Percentage is the minimum percentage of total supply for a buy to be considered. Default is 0.1%.\n\n' +
                 'Examples:\n' +
                 '/freshratio tokenAddress\n' +
                 '/freshratio tokenAddress 2h\n' +
                 '/freshratio tokenAddress 30m 0.5%\n' 
    },
    'tracker': { 
      aliases: ['tr'], 
      minArgs: 0, 
      maxArgs: 0, 
      requiresAuth: true, 
      description: 'Show tracked supplies', 
      dailyLimit: Infinity,
      usage: '/tracker',
      helpMessage: 'Display a list of all your currently tracked supplies.\n\nUse this command to view and manage your active supply tracking sessions.'
    },
    'cancel': { 
      aliases: [], 
      minArgs: 0, 
      maxArgs: 0, 
      requiresAuth: true, 
      description: 'Cancel the current active command', 
      dailyLimit: Infinity,
      usage: '/cancel',
      helpMessage: 'Cancel the currently running command.\n\nUse this to stop a long-running analysis or if you made a mistake in your command input.'
    },
    'access': { 
      aliases: ['join'], 
      minArgs: 0, 
      maxArgs: 0, 
      requiresAuth: false, 
      description: 'Get information about joining the closed beta', 
      dailyLimit: Infinity,
      usage: '/access or /join',
      helpMessage: 'Get information about how to join the closed beta and access the bot.'
    },
  };

  const helpNote = "\n\nFor a better understanding of the bot and its commands, please consult our <a href='https://smp-team.gitbook.io/noesis-bot'>documentation</a>.";

Object.values(commandConfigs).forEach(config => {
  if (config.helpMessage) {
    config.helpMessage += helpNote;
  }
});

const parseCommand = (text) => {
  const parts = text.trim().split(/\s+/);
  let commandWithSlash = parts[0].toLowerCase();

  // Vérifie si la commande inclut une mention de bot et l'extrait
  const botMentionRegex = /^\/([a-z]+)@([a-z0-9_]+)bot$/i;
  const match = commandWithSlash.match(botMentionRegex);
  if (match) {
    commandWithSlash = `/${match[1]}`;
  }

    
  let args = parts.slice(1);

  if (commandWithSlash === '/help' && args.length > 0) {
    const potentialCommand = args[0].startsWith('/') ? args[0].slice(1) : args[0];
    if (commandConfigs[potentialCommand]) {
      return { command: 'help', args: [potentialCommand] };
    }
  }

  if (args.length > 0 && args[args.length - 1].toLowerCase() === 'help') {
    const command = commandWithSlash.startsWith('/') ? commandWithSlash.slice(1) : commandWithSlash;
    return { command: 'help', args: [command] };
  }

  const command = commandWithSlash.startsWith('/') ? commandWithSlash.slice(1) : commandWithSlash;

  for (const [cmd, config] of Object.entries(commandConfigs)) {
    if (cmd === command || config.aliases.includes(command)) {
      return { command: cmd, args };
    }
  }

  return { command: null, args };
};

const getCommandHelp = (command) => {
  const config = commandConfigs[command];
  if (!config) return  `Unknown command. Please use /help for a full list of commands.`;

  if (!config.helpMessage) {
      return `${config.description}\n\nUsage: ${config.usage}\n* = optional parameters\n() = default values`;
  }

  return `${config.description}\n\nUsage: ${config.usage}\n* = optional parameters\n() = default values\n\n${config.helpMessage}`;
};

const validateArgs = (command, args) => {
  const config = commandConfigs[command];
  if (!config) return [ `Unknown command. Please use /help for a full list of commands.`];

  if (args.length === 0 || (args.length === 1 && args[0].toLowerCase() === 'help')) {
    return [getCommandHelp(command)];
  }

  const errors = [];

  if (args.length < config.minArgs) {
    errors.push(`Too few arguments. ${getCommandHelp(command)}`);
  }
  if (args.length > config.maxArgs && config.maxArgs !== Infinity) {
    errors.push(`Too many arguments. ${getCommandHelp(command)}`);
  }

  if (['scan', 'bundle', 'bt', 'th', 'team', 'search', 'eb'].includes(command)) {
    if (!validateSolanaAddress(args[0])) {
      errors.push(`Invalid contract address format. Please provide a valid Solana address.\n\n${getCommandHelp(command)}`);
    }
  }

  return errors;
};

module.exports = {
  commandConfigs,
  parseCommand,
  validateArgs,
  getCommandHelp
};