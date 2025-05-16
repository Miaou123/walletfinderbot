const commandConfigs = {
  'start': { 
    aliases: [], 
    minArgs: 0, 
    maxArgs: 1,
    requiresAuth: false, 
    description: 'Start the bot or use a referral link', 
    usage: '/start [referral_link]',
    helpMessage: 'Use /start to begin using the bot. You can also use a referral link like /start r-username'
  },
  'verify': {
    aliases: ['v'],
    minArgs: 0,
    maxArgs: 0,
    requiresAuth: false,
    requiresToken: false,
    description: 'Verify your wallet to access token-gated features',
    usage: '/verify',
    helpMessage: 'Start the wallet verification process to access token-gated features.\n\n' +
                'This command helps you connect your wallet to the bot by sending a small verification transaction.\n\n' +
                'Benefits:\n' +
                '• Access to token-gated features\n' +
                '• Automatic verification checks\n' +
                '• No need for manual wallet submission'
  },
  'help': { 
    aliases: [], 
    minArgs: 0, 
    maxArgs: 1, 
    requiresAuth: false, 
    description: 'Show help information', 
    usage: '/help [command]',
    helpMessage: ''
  },
  'ping': { 
    aliases: [], 
    minArgs: 0, 
    maxArgs: 0, 
    requiresAuth: false, 
    description: 'Check bot responsiveness', 
    usage: '/ping',
    helpMessage: ''
  },
  'preview': { 
    aliases: [], 
    minArgs: 0, 
    maxArgs: 0, 
    requiresAuth: false, 
    description: 'Get a preview of all Noesis commands', 
    usage: '/preview',
    helpMessage: ''
  },
  'referral': {
    aliases: ['ref'],
    minArgs: 0,
    maxArgs: 0,
    requiresAuth: false,
    description: 'Manage your referral settings and rewards',
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
    usage: '/scan [contract_address] [number_of_top_holders](10)*',
    helpMessage: 'Scan a token for a top holders breakdown.\n\nTip: Increasing the number of top holders analyzed is recommended for a better overview on high mcap tokens (max: 100).'
  },
  'entrymap': {
    aliases: ['em'],
    minArgs: 1,
    maxArgs: 2,
    requiresAuth: true,
    requiresToken: false, // This command requires token verification
    description: 'Analyze entry prices of top holders',
    usage: '/entrymap [contract_address] [number_of_holders](20)*',
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
    usage: '/bundle [contract_address]',
    helpMessage: `Analyze bundled trades for a specific contract address (Raydium, Meteora, and Pumpfun are supported). A bundle is defined as two wallets buying on the same block; it does not have to be the first block bundle. Most pumpfun developers sell and buy in bundles multiple times, so the total bundled amount can be greater than 100%. The "total holding amount" is the most important data to check; if it is close to 0, it means that all bundles have been sold. Finally, not just the team can bundle a coin (for example, some tools with multi-wallet purchases will be detected as a bundle).`
  },
  'walletchecker': { 
    aliases: ['wc'],
    minArgs: 2,
    maxArgs: 2,
    requiresAuth: true,
    requiresToken: true,
    description: 'Analyze wallet trading performance',
    usage: '/w [wallet_address] [timeframe](30d)*',
    helpMessage: 'Analyzes a wallet\'s trading performance, including metrics like:\n- Balance and portfolio value\n- Trading activity and patterns\n- Win rate and ROI\n- Risk metrics and trading behavior'
  },
  'topholders': { 
    aliases: ['th'], 
    minArgs: 1, 
    maxArgs: 2, 
    requiresAuth: false, 
    description: 'Analyze top holders', 
    usage: '/th [contract_address] [number_of_holders](20)*',
    helpMessage: 'Analyze the top holders of a specific coin. You can analyze up to 100 top holders.\n\nTip: Increasing the number of top holders analyzed is recommended for a better overview on high market cap tokens.'
  },
  'team': { 
    aliases: ['t'], 
    minArgs: 1, 
    maxArgs: 1, 
    requiresAuth: true, 
    requiresToken: false,
    description: 'Analyze team supply', 
    usage: '/team [contract_address]',
    helpMessage: 'Analyze team and insider supply for a token using a custom algorithm.\n\nThis command helps identify wallets likely associated with the project team or insiders and estimates the total supply they control.'
  },
  'fresh': { 
    aliases: ['f'], 
    minArgs: 1, 
    maxArgs: 1, 
    requiresAuth: true, 
    requiresToken: false,
    description: 'Analyze fresh wallets', 
    usage: '/fresh [contract_address]',
    helpMessage: 'Analyze fresh wallets holding a token with significant amounts (>0.05% of supply).\n\nThis command identifies wallets with low transaction counts that hold meaningful amounts of a token.'
  },
  'besttraders': { 
    aliases: ['bt'], 
    minArgs: 1, 
    maxArgs: 4, 
    requiresAuth: true, 
    requiresToken: false,
    description: 'Analyze best traders', 
    usage: '/bt [contract_address] [winrate_threshold](50%)* [portfolio_threshold]($10000)* [sort_option](port)*',
    helpMessage: 'Analyse the 100 best traders for a specific contract with given winrate and portfolio thresholds.\n\nSort options:\n- winrate/wr: Sort by win rate\n- pnl: Sort by profit and loss\n- portfolio/port: Sort by portfolio value\n- sol: Sort by SOL balance'
  },
  'earlybuyers': { 
    aliases: ['eb'], 
    minArgs: 1, 
    maxArgs: 4, 
    requiresAuth: true, 
    requiresToken: false,
    description: 'Analyze early buyers', 
    usage: '/eb [coin_address] [time_frame](1h)* [min buy amount](1%)* [pump or nopump]*',
    helpMessage: 'Analyze early buyers of a specific coin within a given time frame and minimum buy amount threshold.\nTime frame is in hours or minutes (e.g., 2h or 30m).\n Percentage is the minimum percentage of total supply bought in one or multiple transactions over the timeframe.\nIf you only want to analyse pumpfun transactions, use the flag "pump" at the end of your command and if you only want to analyse raydium transactions use "nopump"'
  },
  'cross': { 
    aliases: ['c'], 
    minArgs: 2, 
    maxArgs: 6, 
    requiresAuth: true,
    requiresToken: false,
    description: 'Cross-analyze multiple tokens', 
    usage: '/cross [contract_address1] [contract_address2] ... [Combined_value_min]($10000)*',
    helpMessage: 'Search for wallets that hold multiple coins. You can analyze up to 5 coins with a minimum combined value (default is $10000).\n\nThis command helps identify wallets that have significant holdings across multiple tokens.'
  },
  'crossbt': { 
    aliases: ['cbt'], 
    minArgs: 2, 
    maxArgs: 3, 
    requiresAuth: true, 
    requiresToken: false,
    description: 'Cross-analyze top traders of multiple tokens', 
    usage: '/crossbt [contract_address1] [contract_address2] [contract_address3]*',
    helpMessage: 'Analyze and compare the top 100 traders across 2 or 3 tokens to find common wallets. This command will help you find the best traders across a meta or wallets from team/insiders involved in multiple coins. You can analyze up to 3 coins.'
  },
  'search': { 
    aliases: ['sh'], 
    minArgs: 2, 
    maxArgs: Infinity, 
    requiresAuth: true, 
    requiresToken: false,
    description: 'Search for specific wallets', 
    usage: '/search [contract_address] [partial_address1] [partial_address2]*',
    helpMessage: 'Search for wallets that hold a specific token and match the partial addresses provided.\n\nTip: You can add multiple parts to one partial address by separating them with one or multiple dots.'
  },
  'dev': {
    aliases: ['d'], 
    minArgs: 1,
    maxArgs: 1,
    requiresAuth: true,
    requiresToken: false,
    description: 'Analyze pumpfun developer profile and previous coins',
    usage: '/dev [contract_address]',
    helpMessage: 'Analyze a developer wallet to check their history of creating coins, including success rate, bonding rate, funding methods and connections to other successful projects.'
  },
  'walletsearch': {
    aliases: ['ws'],
    minArgs: 0,
    maxArgs: 0,
    requiresAuth: true,
    requiresToken: false,
    description: 'Search for wallets by criteria',
    usage: '/walletsearch',
    helpMessage: 'Search for wallets based on criteria like Win Rate, Portfolio Value, Profit, and SOL Balance.\n\n' +
                'This interactive search allows you to set multiple criteria and find wallets matching all conditions.\n\n' +
                'Examples of what you can find:\n' +
                '• High value traders with strong performance\n' +
                '• Wealthy traders accumulating SOL\n' +
                '• Consistent profit makers\n\n' +
                'Simply use /walletsearch with no arguments to start the interactive search panel.'
},
  'tracker': { 
    aliases: ['tr'], 
    minArgs: 0, 
    maxArgs: 0, 
    requiresAuth: false, 
    requiresToken: false,
    description: 'Show tracked supplies', 
    usage: '/tracker',
    helpMessage: 'Display a list of all your currently tracked supplies.\n\nUse this command to view and manage your active supply tracking sessions.'
  },
  'verifygroup': {
    aliases: ['vg', 'groupverify'],
    minArgs: 0,
    maxArgs: 0,
    requiresAuth: false,
    requiresToken: false,
    description: 'Verify your group using token verification',
    usage: '/verifygroup',
    helpMessage: 'Start the group wallet verification process to access token-gated features.\n\n' +
                'This command helps you verify your group by sending a small amount of tokens:\n\n' +
                '• Only group admins can initiate verification\n' +
                '• No wallet connection necessary\n' +
                `• Requires ${process.env.MIN_TOKEN_THRESHOLD || 1} ${process.env.TOKEN_SYMBOL || 'tokens'} minimum\n\n` +
                'Once verified, your group will have access to all token-gated features without a subscription.'
},
  'subscribe': {
    aliases: ['sub'],
    minArgs: 0,
    maxArgs: 0,
    requiresAuth: false,
    description: 'Start a new subscription for bot access',
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
    usage: '/subscribe_group',
    helpMessage: 'Start the group subscription process (2.0 SOL/month).\n\n' +
                  'Requirements:\n' +
                  '• Must be used in the target group\n' +
                  '• Must be a group administrator\n' +
                  '• Bot must have admin rights\n\n' +
                  'After initiating, follow the payment instructions to complete the group subscription.'
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
    usage: '/removeuser [username]',
    helpMessage: 'Remove a user from the whitelist.\n\nExample:\n/removeuser username'
  },
  'getuser': {
    aliases: [],
    minArgs: 1,
    maxArgs: 1,
    requiresAuth: true,
    description: 'fetch the full infomation on a user',
    usage: '/getuser [username]',
    helpMessage: 'fetch the full infomation on a user.\n\nExample:\n/getuser username'
  },
  'addgroup': {
    aliases: [],
    minArgs: 0,
    maxArgs: 2,
    requiresAuth: true,
    description: 'Add a group to whitelist',
    usage: '/addgroup [type]',
    helpMessage: 'Add the current group to whitelist or specify group ID and type.\nTypes: normal, vip\n\nExamples:\n/addgroup\n/addgroup vip\n/addgroup -1001234567890 normal'
  },
  'removegroup': {
    aliases: [],
    minArgs: 1,
    maxArgs: 1,
    requiresAuth: true,
    description: 'Remove a group from whitelist',
    usage: '/removegroup [group_id]',
    helpMessage: 'Remove a group from the whitelist.\n\nExample:\n/removegroup -1001234567890'
  },
  'addsub': {
    aliases: [],
    minArgs: 2,
    maxArgs: 2,
    requiresAuth: true,
    description: 'Add a subscription for a user (Admin only)',
    usage: '/addsub [username/userID] [duration]',
    helpMessage: 'Add a subscription for a user (Admin only)'
  },
  'addgroupsub': {
    aliases: [],
    minArgs: 2,
    maxArgs: 2,
    requiresAuth: true,
    description: 'Add a subscription for a group (Admin only)',
    usage: '/addgroupsub [duration]',
    helpMessage: 'Add a subscription for a group (Admin only)'
  },
  'removesub': {
    aliases: [],
    minArgs: 1,
    maxArgs: 1,
    requiresAuth: true,
    description: 'Remove a user from the subscription list',
    usage: '/removesub [username/userID]',
    helpMessage: 'Remove a user from the subscription list'
  },
  'removegroupsub': {
    aliases: [],
    minArgs: 1,
    maxArgs: 1,
    requiresAuth: true,
    description: 'Remove a group from the group subscription list',
    usage: '/removegroupsub [groupName/groupID]',
    helpMessage: 'Remove a group from the group subscription list'
  },
  'checksub': {
    aliases: [],
    minArgs: 1,
    maxArgs: 1,
    requiresAuth: true,
    description: 'Check if a user is subscribed',
    usage: '/checksub [username/userID]',
    helpMessage: 'Check the subscription for a user'
  },
  'listsubs': {
    aliases: [],
    minArgs: 0,
    maxArgs: 0,
    requiresAuth: true,
    description: 'list of all the currently subscribed users',
    usage: '/listsubs',
    helpMessage: 'list of all the users currently subscribed and their subscription time'
  },
  'listgroupsubs': {
    aliases: [],
    minArgs: 0,
    maxArgs: 0,
    requiresAuth: true,
    description: 'list of all the currently subscribed groups',
    usage: '/listsubs',
    helpMessage: 'list of all the groups currently subscribed and their subscription time'
  },
  'listgroups': {
    aliases: [],
    minArgs: 0,
    maxArgs: 0,
    requiresAuth: true,
    description: 'List all whitelisted groups',
    usage: '/listgroups',
    helpMessage: 'Display a list of all whitelisted groups and their types.'
  },
  'usagestats': {
    aliases: [],
    minArgs: 0,
    maxArgs: 0,
    requiresAuth: true,
    description: 'Show command usage statistics',
    usage: '/usagestats',
    helpMessage: 'Display statistics about command usage across all users.'
  },
  'broadcast': {
    aliases: [],
    minArgs: 1,
    maxArgs: Infinity,
    requiresAuth: true,
    description: 'Send message to all users',
    usage: '/broadcast [message]',
    helpMessage: 'Send a message to all whitelisted users.\n\nExample:\n/broadcast Hello everyone!'
  },
  'broadcastlocal': {
    aliases: ['bclocal'],
    minArgs: 1,
    maxArgs: Infinity,
    requiresAuth: true,
    description: 'Test broadcast message locally',
    usage: '/broadcastlocal [message]',
    helpMessage: 'Preview how a broadcast message will look by sending it only to yourself.\n\nThis is useful for checking formatting and catching errors before broadcasting to all users.\n\nExample:\n/broadcastlocal Hello everyone!'
  },
  'imagebroadcast': {
    aliases: ['imgbc'],
    minArgs: 0,
    maxArgs: 0,
    requiresAuth: true,
    description: 'Broadcast a message with an image to all users',
    usage: '/imagebroadcast',
    helpMessage: 'Start the image broadcast wizard to send an image with caption to all users.'
},
'imagebroadcastlocal': {
    aliases: ['imgbclocal'],
    minArgs: 0,
    maxArgs: 0,
    requiresAuth: true,
    description: 'Test an image broadcast locally',
    usage: '/imagebroadcastlocal',
    helpMessage: 'Preview how an image broadcast will look without sending to users.'
},
};

module.exports = {
    commandConfigs,
    adminCommandConfigs
};