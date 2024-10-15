// botDetector.js

const MAXIMUM_UPL = 2000000;
const BOT_TRANSACTION_THRESHOLD = 10000;
const BOT_TRANSACTION_DIFFERENCE_THRESHOLD = 0.05;

/**
 * Détermine si un portefeuille est probablement un bot basé sur ses données de transaction.
 * @param {Object} walletData - Les données du portefeuille à analyser.
 * @param {number} walletData.buy - Le nombre de transactions d'achat.
 * @param {number} walletData.sell - Le nombre de transactions de vente.
 * @param {number} walletData.unrealized_profit - Le profit non réalisé du portefeuille.
 * @returns {boolean} - True si le portefeuille est probablement un bot, false sinon.
 */
const isBotWallet = (walletData) => {
    const buy = parseInt(walletData.buy) || 0;
    const sell = parseInt(walletData.sell) || 0;
    const totalTransactions = buy + sell;
    const upl = parseFloat(walletData.unrealized_profit) || 0;

    if (totalTransactions < BOT_TRANSACTION_THRESHOLD) {
        return false;
    }

    const difference = Math.abs(buy - sell) / totalTransactions;
    const isHighUPL = upl > MAXIMUM_UPL;

    return difference < BOT_TRANSACTION_DIFFERENCE_THRESHOLD || isHighUPL;
};

/**
 * Analyse un groupe de portefeuilles et retourne ceux qui sont probablement des bots.
 * @param {Array<Object>} wallets - Un tableau d'objets représentant des portefeuilles.
 * @returns {Array<Object>} - Un tableau des portefeuilles identifiés comme bots.
 */
const identifyBotWallets = (wallets) => {
    return wallets.filter(wallet => isBotWallet(wallet));
};

/**
 * Calcule le pourcentage de bots dans un groupe de portefeuilles.
 * @param {Array<Object>} wallets - Un tableau d'objets représentant des portefeuilles.
 * @returns {number} - Le pourcentage de bots (0-100).
 */
const calculateBotPercentage = (wallets) => {
    const botCount = identifyBotWallets(wallets).length;
    return (botCount / wallets.length) * 100;
};

module.exports = {
    isBotWallet,
    identifyBotWallets,
    calculateBotPercentage,
    MAXIMUM_UPL,
    BOT_TRANSACTION_THRESHOLD,
    BOT_TRANSACTION_DIFFERENCE_THRESHOLD
};