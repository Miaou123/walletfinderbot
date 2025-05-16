require('dotenv').config();

const sensitiveConfig = {
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN,
  HELIUS_API_KEY: process.env.HELIUS_API_KEY,
  CIELO_API_URL: process.env.CIELO_API_URL ? `https://api.cielo.app/${process.env.CIELO_API_URL}` : '',
  CIELO_API_KEY: process.env.CIELO_API_KEY,
  MONGODB_URI: process.env.MONGODB_URI,
  DEFINED_API_KEY: process.env.DEFINED_API_KEY,
  adminIds: process.env.ADMIN_IDS,
  REWARD_WALLET_PRIVATE_KEY: process.env.REWARD_WALLET_PRIVATE_KEY,
};

const nonSensitiveConfig = {
  TOP_HOLDERS_COUNT: 100,
  LOW_TRANSACTION_THRESHOLD: 100,
  MIN_TOKEN_THRESHOLD: 10000,
  INACTIVITY_THRESHOLD_DAYS: 5,
  MIN_SOL_BALANCE_FOR_ANALYSIS: 0,
  HIGH_WALLET_VALUE_THRESHOLD: 20000,
  CHECK_INTERVAL: 1 * 60 * 1000,
  SOL_DECIMALS: 9,
  PUMPFUN_DECIMALS: 6,
  DEX_PROGRAM_IDS: {
    RAYDIUM: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
    METEORA: 'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB',
    MOONSHOT: 'MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG',
  },
  
};

const tokenGatingConfig = {
  TOKEN_ADDRESS: process.env.TOKEN_ADDRESS,
  TOKEN_SYMBOL: process.env.TOKEN_SYMBOL || 'tokens',
  MIN_TOKEN_THRESHOLD: parseInt(process.env.MIN_TOKEN_THRESHOLD || '1'),
  BALANCE_CHECK_INTERVAL: parseInt(process.env.BALANCE_CHECK_INTERVAL || '24'),
  NOTIFY_ON_REVOKE: process.env.NOTIFY_ON_REVOKE === 'true'
};

const config = {
  ...sensitiveConfig,
  ...nonSensitiveConfig,
  ...tokenGatingConfig,
  HELIUS_RPC_URL: sensitiveConfig.HELIUS_API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${sensitiveConfig.HELIUS_API_KEY}` : '',
};

const requiredEnvVars = ['TELEGRAM_TOKEN', 'HELIUS_API_KEY', 'MONGODB_URI'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Error: Environment variable ${envVar} is not set.`);
    process.exit(1);
  }
}

module.exports = config;