const logger = require('../utils/logger');
const { getSolanaApi } = require('../integrations/solanaApi');

const FRESH_WALLET_THRESHOLD = 50;

async function isFreshWallet(address, targetTxHash, mainContext, subContext) {
    logger.debug(`Checking if wallet ${address} was fresh at transaction ${targetTxHash}`);

    try {
        const solanaApi = getSolanaApi();
        
        // Récupérer toutes les signatures jusqu'au targetTxHash
        const signatures = await solanaApi.getSignaturesForAddress(
            address,
            { 
                limit: FRESH_WALLET_THRESHOLD + 1, // +1 pour inclure la transaction cible
                until: targetTxHash
            },
            mainContext,
            subContext
        );

        if (!signatures) {
            logger.warn(`No signatures found for wallet ${address}`);
            return false;
        }

        // Si on n'a pas trouvé la transaction cible
        if (!signatures.find(sig => sig.signature === targetTxHash)) {
            logger.warn(`Target transaction ${targetTxHash} not found for wallet ${address}`);
            return false;
        }

        // Le nombre de transactions avant la transaction cible
        const txCount = signatures.length - 1; // -1 car on ne compte pas la transaction cible
        const isFresh = txCount <= FRESH_WALLET_THRESHOLD;
        
        logger.debug(`Wallet ${address} had ${txCount} transactions before target tx, isFresh: ${isFresh}`);
        return isFresh;

    } catch (error) {
        logger.error(`Error checking if ${address} was a fresh wallet:`, error);
        if (error.stack) {
            logger.debug(`Error stack: ${error.stack}`);
        }
        return false;
    }
}

module.exports = {
    isFreshWallet,
    FRESH_WALLET_THRESHOLD
};