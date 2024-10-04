require('dotenv').config();

const config = {
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN || '',
  HELIUS_API_KEY: process.env.HELIUS_API_KEY || '',
  HELIUS_RPC_URL: process.env.HELIUS_API_KEY ? `https://rpc.helius.xyz/?api-key=${process.env.HELIUS_API_KEY}` : '',
  CIELO_API_URL: process.env.CIELO_API_URL ? `https://api.cielo.app/${process.env.CIELO_API_URL}` : '',
  CIELO_API_KEY: process.env.CIELO_API_KEY || '',
  MONGODB_URI: process.env.MONGODB_URI || '',
  
  // Non-sensitive configuration
  TOP_HOLDERS_COUNT: 100,
  LOW_TRANSACTION_THRESHOLD: 100,
  MIN_TOKEN_THRESHOLD: 10000,
  INACTIVITY_THRESHOLD_DAYS: 5,
  MIN_SOL_BALANCE_FOR_ANALYSIS: 0,
  HIGH_WALLET_VALUE_THRESHOLD: 20000,
  CHECK_INTERVAL: 1 * 60 * 1000,
  SOL_DECIMALS: 9,
  DEX_PROGRAM_IDS: {
    RAYDIUM: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
    METEORA: 'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB',
    MOONSHOT: 'MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG',
  },
};

module.exports = config;
