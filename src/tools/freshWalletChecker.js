const logger = require('../utils/logger');
const { getSolanaApi } = require('../integrations/solanaApi');

const FRESH_WALLET_THRESHOLD = 50;

async function isFreshWallet(address, targetTxHash, mainContext, subContext) {
    logger.debug(`Checking if wallet ${address} was fresh at transaction ${targetTxHash}`);

    try {
        const solanaApi = getSolanaApi();
        let txCount = 0;
        let foundTargetTx = false;
        let beforeCursor = null;

        while (!foundTargetTx) {
            logger.debug(`Getting signatures batch for ${address}, cursor: ${beforeCursor}`);
            
            const signatures = await solanaApi.getSignaturesForAddress(
                address,
                { 
                    before: beforeCursor,
                    limit: 1000 // Maximum batch size
                },
                mainContext,
                subContext
            );

            if (!signatures || signatures.length === 0) {
                logger.debug(`No more signatures found for ${address}`);
                break;
            }

            for (const sig of signatures) {
                if (sig.signature === targetTxHash) {
                    foundTargetTx = true;
                    logger.debug(`Found target transaction. Total transactions before: ${txCount}`);
                    break;
                }
                txCount++;
            }

            if (!foundTargetTx && signatures.length > 0) {
                beforeCursor = signatures[signatures.length - 1].signature;
            }

            // Optimisation : arrêter si on dépasse déjà le seuil
            if (txCount > FRESH_WALLET_THRESHOLD && !foundTargetTx) {
                logger.debug(`Transaction count exceeded threshold (${FRESH_WALLET_THRESHOLD}) before finding target tx`);
                return false;
            }
        }

        if (!foundTargetTx) {
            logger.warn(`Target transaction ${targetTxHash} not found for wallet ${address}`);
            return false;
        }

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