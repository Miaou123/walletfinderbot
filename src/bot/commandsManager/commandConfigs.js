const validateSolanaAddress = (address) => {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  };
  
  const commandConfigs = {
    'start': { 
      aliases: [], 
      minArgs: 0, 
      maxArgs: 1,  // Allow one optional argument for the referral link
      requiresAuth: false, 
      description: 'Start the bot or use a referral link', 
      dailyLimit: Infinity,
      usage: '/start [referral_link]',
      helpMessage: 'Use /start to begin using the bot. You can also use a referral link like /start r-username'
    },
    'help': { 
      aliases: [], 
      minArgs: 0, 
      maxArgs: 1, 
      requiresAuth: false, 
      description: 'Show help information', 
      dailyLimit: Infinity,
      usage: '/help [command]',
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
    'referral': {
      aliases: ['ref'],
      minArgs: 0,
      maxArgs: 0,
      requiresAuth: false,
      description: 'Manage your referral settings and rewards',
      dailyLimit: Infinity,
      usage: '/referral',
      helpMessage: 'View and manage your referral rewards. Set your reward wallet address and track earned commissions from referrals.'
    },
    'dexpaid': {
      aliases: ['dp'],
      minArgs: 1,
      maxArgs: 1,
      requiresAuth: false,
      description: 'Check if a token profile has been updated on dexscreener and if there are other services running (ads or boosts)',
      usage: '/dp [contract_address]',
      helpMessage: 'Check if a token profile has been updated on dexscreener and if there are other services running (ads or boosts)\n\nExample:\n/dp tokenAddress'
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
    'entrymap': {
      aliases: ['em'],
      minArgs: 1,
      maxArgs: 2,
      requiresAuth: true,
      description: 'Analyze entry prices of top holders',
      usage: '/entrymap [contract_address] [number_of_holders=20]',
      helpMessage: 'Analyzes the entry prices of top holders for a given token.\n\n' +
                  'Shows:\n' +
                  '• Average entry prices and PnLs\n' +
                  '• Current PnL/ average entry for each holder\n' +
                  'Example:\n/entrymap tokenAddress'
    },
    'bundle': { 
      aliases: ['bd'], 
      minArgs: 1, 
      maxArgs: 1, 
      requiresAuth: false, 
      description: 'Analyze bundled trades', 
      dailyLimit: Infinity,
      usage: '/bundle [contract_address]',
      helpMessage: `Analyze bundled trades for a specific contract address (Raydium, Meteora, and Pumpfun are supported). A bundle is defined as two wallets buying on the same block; it does not have to be the first block bundle. Most pumpfun developers sell and buy in bundles multiple times, so the total bundled amount can be greater than 100%. The "total holding amount" is the most important data to check; if it is close to 0, it means that all bundles have been sold. Finally, not just the team can bundle a coin (for example, some tools with multi-wallet purchases will be detected as a bundle).`
    },
    'besttraders': { 
      aliases: ['bt'], 
      minArgs: 1, 
      maxArgs: 4, 
      requiresAuth: true, 
      description: 'Analyze best traders', 
      dailyLimit: 5,
      usage: '/bt [contract_address] [winrate_threshold](50%)* [portfolio_threshold]($10000)* [sort_option](port)*',
      helpMessage: 'Analyse the 100 best traders for a specific contract with given winrate and portfolio thresholds.\n\nSort options:\n- winrate/wr: Sort by win rate\n- pnl: Sort by profit and loss\n- portfolio/port: Sort by portfolio value\n- sol: Sort by SOL balance'
    },
    'topholders': { 
      aliases: ['th'], 
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
    'earlybuyers': { 
      aliases: ['eb'], 
      minArgs: 1, 
      maxArgs: 4, 
      requiresAuth: true, 
      description: 'Analyze early buyers', 
      dailyLimit: 5,
      usage: '/eb [coin_address] [time_frame](1h)* [min buy amount](1%)* [pump or nopump]*',
      helpMessage: 'Analyze early buyers of a specific coin within a given time frame and minimum buy amount threshold.\n\nTime frame is in hours or minutes (e.g., 2h or 30m). Percentage is the minimum percentage of total supply bought in one or multiple transactions over the timeframe.If you only want to analyse pumpfun transactions, use the flag "pump" at the end of your command and if you only want to analyse raydium transactions use "nopump"'
    },
    'dev': {
      aliases: ['d'], 
      minArgs: 1,
      maxArgs: 1,
      requiresAuth: true,
      description: 'Analyze pumpfun developer profile and previous coins',
      dailyLimit: 10,
      usage: '/dev [contract_address]',
      helpMessage: 'Analyze a developer wallet to check their history of creating coins, including success rate, bonding rate, funding methods and connections to other successful projects.'
    },
    'freshratio': {
      aliases: ['fr'],
      minArgs: 1,
      maxArgs: 3,
      requiresAuth: true,
      description: 'Analyze fresh wallet ratio',
      dailyLimit: 10,
      usage: '/freshratio [contract_address] [time_frame](1h)* [min buy amount](0.005%)*',
      helpMessage: 'Analyze the proportion of fresh wallets buying a token over a specific time frame.\n\n' +
                   'Time frame is in hours or minutes (e.g., 1h, 30m, 5d). Default is 1 hour.\n' +
                   'Percentage is the minimum percentage of total supply for a buy to be considered. Default is 0.005%.\n\n' +
                   'Examples:\n' +
                   '/freshratio tokenAddress\n' +
                   '/freshratio tokenAddress 2h\n' +
                   '/freshratio tokenAddress 5d 0.01%\n'
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
    'subscribe': {
      aliases: ['sub'],
      minArgs: 0,
      maxArgs: 0,
      requiresAuth: false,
      description: 'Start a new subscription for bot access',
      dailyLimit: Infinity,
      usage: '/subscribe',
      helpMessage: 'Start the subscription process to access premium features.\n\n' +
                   'Available options:\n' +
                   '• 1 Month (0.5 SOL)\n' +
                   '• 3 Months (1.2 SOL)\n' +
                   '• 6 Months (2.0 SOL)\n\n' +
                   'After selecting your plan, follow the payment instructions to complete your subscription.'
    },
    'subscribe_group': {
      aliases: ['subgroup'],
      minArgs: 0,
      maxArgs: 0,
      requiresAuth: false,
      description: 'Subscribe a group to the bot',
      dailyLimit: Infinity,
      usage: '/subscribe_group',
      helpMessage: 'Start the group subscription process (2.0 SOL/month).\n\n' +
                   'Requirements:\n' +
                   '• Must be used in the target group\n' +
                   '• Must be a group administrator\n' +
                   '• Bot must have admin rights\n\n' +
                   'After initiating, follow the payment instructions to complete the group subscription.'
    },
    'mysubscription': { 
      aliases: ['mysub'], 
      minArgs: 0, 
      maxArgs: 0, 
      requiresAuth: false, 
      description: 'View your active subscription', 
      dailyLimit: Infinity,
      usage: '/mysubscription',
      helpMessage: 'View your current active subscription details.'
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
  
  // Configuration des commandes admin
  const adminCommandConfigs = {
    'removeuser': {
      aliases: [],
      minArgs: 1,
      maxArgs: 1,
      requiresAuth: true,
      description: 'Remove a user from whitelist',
      dailyLimit: Infinity,
      usage: '/removeuser [username]',
      helpMessage: 'Remove a user from the whitelist.\n\nExample:\n/removeuser username'
    },
    'getuser': {
      aliases: [],
      minArgs: 1,
      maxArgs: 1,
      requiresAuth: true,
      description: 'fetch the full infomation on a user',
      dailyLimit: Infinity,
      usage: '/getuser [username]',
      helpMessage: 'fetch the full infomation on a user.\n\nExample:\n/getuser username'
    },
    'addgroup': {
      aliases: [],
      minArgs: 0,
      maxArgs: 2,
      requiresAuth: true,
      description: 'Add a group to whitelist',
      dailyLimit: Infinity,
      usage: '/addgroup [type]',
      helpMessage: 'Add the current group to whitelist or specify group ID and type.\nTypes: normal, vip\n\nExamples:\n/addgroup\n/addgroup vip\n/addgroup -1001234567890 normal'
    },
    'removegroup': {
      aliases: [],
      minArgs: 1,
      maxArgs: 1,
      requiresAuth: true,
      description: 'Remove a group from whitelist',
      dailyLimit: Infinity,
      usage: '/removegroup [group_id]',
      helpMessage: 'Remove a group from the whitelist.\n\nExample:\n/removegroup -1001234567890'
    },
    'addsub': {
      aliases: [],
      minArgs: 2,
      maxArgs: 2,
      requiresAuth: true,
      description: 'Add a subscription for a user (Admin only)',
      dailyLimit: Infinity,
      usage: '/addsub [username/userID] [duration]',
      helpMessage: 'Add a subscription for a user (Admin only)'
    },
    'addgroupsub': {
      aliases: [],
      minArgs: 2,
      maxArgs: 2,
      requiresAuth: true,
      description: 'Add a subscription for a group (Admin only)',
      dailyLimit: Infinity,
      usage: '/addgroupsub [duration]',
      helpMessage: 'Add a subscription for a group (Admin only)'
    },
    'removesub': {
      aliases: [],
      minArgs: 1,
      maxArgs: 1,
      requiresAuth: true,
      description: 'Remove a user from the subscription list',
      dailyLimit: Infinity,
      usage: '/removesub [username/userID]',
      helpMessage: 'Remove a user from the subscription list'
    },
    'removegroupsub': {
      aliases: [],
      minArgs: 1,
      maxArgs: 1,
      requiresAuth: true,
      description: 'Remove a group from the group subscription list',
      dailyLimit: Infinity,
      usage: '/removegroupsub [groupName/groupID]',
      helpMessage: 'Remove a group from the group subscription list'
    },
    'checksub': {
      aliases: [],
      minArgs: 1,
      maxArgs: 1,
      requiresAuth: true,
      description: 'Check if a user is subscribed',
      dailyLimit: Infinity,
      usage: '/checksub [username/userID]',
      helpMessage: 'Check the subscription for a user'
    },
    'listsubs': {
      aliases: [],
      minArgs: 0,
      maxArgs: 0,
      requiresAuth: true,
      description: 'list of all the currently subscribed users',
      dailyLimit: Infinity,
      usage: '/listsubs',
      helpMessage: 'list of all the users currently subscribed and their subscription time'
    },
    'listgroupsubs': {
      aliases: [],
      minArgs: 0,
      maxArgs: 0,
      requiresAuth: true,
      description: 'list of all the currently subscribed groups',
      dailyLimit: Infinity,
      usage: '/listsubs',
      helpMessage: 'list of all the groups currently subscribed and their subscription time'
    },
    'listgroups': {
      aliases: [],
      minArgs: 0,
      maxArgs: 0,
      requiresAuth: true,
      description: 'List all whitelisted groups',
      dailyLimit: Infinity,
      usage: '/listgroups',
      helpMessage: 'Display a list of all whitelisted groups and their types.'
    },
    'usagestats': {
      aliases: [],
      minArgs: 0,
      maxArgs: 0,
      requiresAuth: true,
      description: 'Show command usage statistics',
      dailyLimit: Infinity,
      usage: '/usagestats',
      helpMessage: 'Display statistics about command usage across all users.'
    },
    'broadcast': {
      aliases: [],
      minArgs: 1,
      maxArgs: Infinity,
      requiresAuth: true,
      description: 'Send message to all users',
      dailyLimit: Infinity,
      usage: '/broadcast [message]',
      helpMessage: 'Send a message to all whitelisted users.\n\nExample:\n/broadcast Hello everyone!'
    }
  };

module.exports = {
    commandConfigs,
    adminCommandConfigs
};