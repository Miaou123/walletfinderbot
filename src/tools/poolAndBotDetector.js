const { getSolanaApi } = require('../integrations/solanaApi');
const BigNumber = require('bignumber.js');
const logger = require('../utils/logger');

const MAXIMUM_UPL = 2000000;
const BOT_TRANSACTION_THRESHOLD = 10000;
const BOT_TRANSACTION_DIFFERENCE_THRESHOLD = 0.05;

// Mapping des propriétaires de pools
const POOL_OWNERS = new Map([
    ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', 'Pump.fun'],
    ['MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG', 'Moonshot'],
    ['LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', 'Meteora']
]);

// Adresse spécifique de la pool v4 Raydium
const RAYDIUM_V4_POOL_ADDRESS = '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1';

/**
 * Vérifie si une adresse est un pool de liquidité et retourne son type.
 * @param {string} address - L'adresse du portefeuille à vérifier.
 * @param {string} mainContext - Le contexte principal pour le suivi des appels API.
 * @returns {Promise<string|null>} - Le type de pool ou null si ce n'est pas un pool.
 */
const checkLiquidityPool = async (address, mainContext = 'default') => {
    try {
        logger.info(`Checking if address ${address} is a liquidity pool`);
        const solanaApi = getSolanaApi();
        const accountInfo = await solanaApi.getAccountInfo(address, { encoding: 'jsonParsed' }, mainContext, 'checkLiquidityPool');
        
        logger.info(`Account info received for ${address}:`, JSON.stringify(accountInfo, null, 2));

        if (accountInfo && accountInfo.value) {
            // Vérifier si c'est la pool v4 de Raydium
            if (address === RAYDIUM_V4_POOL_ADDRESS) {
                logger.info(`${address} identified as Raydium v4 pool`);
                return 'Raydium';
            }

            // Vérifier si le propriétaire est dans notre mapping de pools connus
            const owner = accountInfo.value.owner;
            if (POOL_OWNERS.has(owner)) {
                const poolType = POOL_OWNERS.get(owner);
                logger.info(`${address} identified as ${poolType} pool (owner: ${owner})`);
                return poolType;
            }
        }

        logger.info(`${address} not identified as any known pool type`);
        return null;
    } catch (error) {
        logger.error(`Error checking liquidity pool for ${address}:`, error);
        return null;
    }
};

/**
 * Détermine si un portefeuille est un bot, un pool de liquidité, ou aucun des deux.
 * @param {Object} walletData - Les données du portefeuille à analyser.
 * @param {string} address - L'adresse du portefeuille.
 * @param {string} mainContext - Le contexte principal pour le suivi des appels API.
 * @returns {Promise<{type: string, subType: string|null}>} - Le type (bot, pool, ou normal) et le sous-type si applicable.
 */
const analyzeWallet = async (walletData, address, mainContext = 'default') => {
    const buy = new BigNumber(walletData.buy || 0);
    const sell = new BigNumber(walletData.sell || 0);
    const totalTransactions = buy.plus(sell);
    const upl = new BigNumber(walletData.unrealized_profit || 0);

    // Vérifier d'abord si c'est un pool de liquidité
    const poolType = await checkLiquidityPool(address, mainContext);
    if (poolType) {
        return { type: 'pool', subType: poolType };
    }

    // Ensuite, vérifier si c'est un bot
    if (totalTransactions.isGreaterThanOrEqualTo(BOT_TRANSACTION_THRESHOLD)) {
        const difference = buy.minus(sell).abs().dividedBy(totalTransactions);
        const isHighUPL = upl.isGreaterThan(MAXIMUM_UPL);

        if (difference.isLessThan(BOT_TRANSACTION_DIFFERENCE_THRESHOLD) || isHighUPL) {
            return { type: 'bot', subType: null };
        }
    }

    return { type: 'normal', subType: null };
};

/**
 * Analyse un groupe de portefeuilles et les catégorise.
 * @param {Array<Object>} wallets - Un tableau d'objets représentant des portefeuilles.
 * @param {string} mainContext - Le contexte principal pour le suivi des appels API.
 * @returns {Promise<Array<Object>>} - Un tableau des portefeuilles analysés avec leur type.
 */
const analyzeWallets = async (wallets, mainContext = 'default') => {
    return Promise.all(wallets.map(async wallet => {
        const analysis = await analyzeWallet(wallet, wallet.address, mainContext);
        return { ...wallet, ...analysis };
    }));
};

/**
 * Calcule les statistiques des portefeuilles analysés.
 * @param {Array<Object>} analyzedWallets - Un tableau de portefeuilles analysés.
 * @returns {Object} - Les statistiques des portefeuilles.
 */
const calculateWalletStats = (analyzedWallets) => {
    const total = analyzedWallets.length;
    const botCount = analyzedWallets.filter(w => w.type === 'bot').length;
    const poolCount = analyzedWallets.filter(w => w.type === 'pool').length;
    const normalCount = total - botCount - poolCount;

    return {
        total,
        botPercentage: (botCount / total) * 100,
        poolPercentage: (poolCount / total) * 100,
        normalPercentage: (normalCount / total) * 100,
        botCount,
        poolCount,
        normalCount
    };
};

module.exports = {
    analyzeWallet,
    analyzeWallets,
    calculateWalletStats,
    MAXIMUM_UPL,
    BOT_TRANSACTION_THRESHOLD,
    BOT_TRANSACTION_DIFFERENCE_THRESHOLD
};