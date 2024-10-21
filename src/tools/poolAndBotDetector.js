const { getSolanaApi } = require('../integrations/solanaApi');
const BigNumber = require('bignumber.js');
const logger = require('../utils/logger');

class PoolAndBotDetector {
    constructor() {
        this.MAXIMUM_UPL = 2000000;
        this.BOT_TRANSACTION_THRESHOLD = 10000;
        this.BOT_TRANSACTION_DIFFERENCE_THRESHOLD = 0.05;

        this.POOL_OWNERS = new Map([
            ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', 'Pump.fun'],
            ['MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG', 'Moonshot'],
            ['LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', 'Meteora']
        ]);

        this.RAYDIUM_V4_POOL_ADDRESS = '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1';
    }

    async checkLiquidityPool(address, mainContext = 'default') {
        try {
            logger.debug(`Checking if address ${address} is a liquidity pool`);
            const solanaApi = getSolanaApi();
            const accountInfo = await solanaApi.getAccountInfo(address, { encoding: 'jsonParsed' }, mainContext, 'checkLiquidityPool');

            if (accountInfo && accountInfo.value) {
                if (address === this.RAYDIUM_V4_POOL_ADDRESS) {
                    return 'Raydium';
                }

                const owner = accountInfo.value.owner;
                if (this.POOL_OWNERS.has(owner)) {
                    const poolType = this.POOL_OWNERS.get(owner);
                    return poolType;
                }
            }

            logger.debug(`${address} not identified as any known pool type`);
            return null;
        } catch (error) {
            logger.error(`Error checking liquidity pool for ${address}:`, error);
            return null;
        }
    }

    async analyzeWallet(walletData, mainContext = 'default') {
        const { wallet, data } = walletData;

        if (!wallet) {
            logger.warn('Attempt to analyze wallet with undefined address');
            return { ...walletData, type: 'unknown', subType: null };
        }

        logger.debug(`Analyzing wallet: ${wallet}`);

        const poolType = await this.checkLiquidityPool(wallet, mainContext);
        if (poolType) {
            logger.debug(`Wallet ${wallet} identified as ${poolType} pool`);
            return { ...walletData, type: 'pool', subType: poolType };
        }

        if (!data || !data.data) {
            logger.warn(`No data available for wallet ${wallet}`);
            return { ...walletData, type: 'unknown', subType: null };
        }

        const walletInfo = data.data;

        const buy = new BigNumber(walletInfo.buy || 0);
        const sell = new BigNumber(walletInfo.sell || 0);
        const totalTransactions = buy.plus(sell);
        console.log("total tx is:", totalTransactions);
        const upl = new BigNumber(walletInfo.unrealized_profit || 0);

        logger.debug(`Total transactions for ${wallet}: ${totalTransactions.toString()}`);

        if (totalTransactions.isGreaterThanOrEqualTo(this.BOT_TRANSACTION_THRESHOLD)) {
            const difference = buy.minus(sell).abs().dividedBy(totalTransactions);
            const isHighUPL = upl.isGreaterThan(this.MAXIMUM_UPL);

            if (difference.isLessThan(this.BOT_TRANSACTION_DIFFERENCE_THRESHOLD) || isHighUPL) {
                logger.debug(`Wallet ${wallet} identified as bot`);
                return { ...walletData, type: 'bot', subType: null };
            }
        }

        logger.info(`Wallet ${wallet} identified as normal`);
        return { ...walletData, type: 'normal', subType: null };
    }
}

module.exports = PoolAndBotDetector;