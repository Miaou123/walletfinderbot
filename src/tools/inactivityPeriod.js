const config = require('../utils/config');
const { getSolanaApi } = require('../integrations/solanaApi');
const logger = require('../utils/logger');

const solanaApi = getSolanaApi();

async function checkInactivityPeriod(address, coinAddress, mainContext, subContext = 'checkInactivity') {
  try {
    const tokenAccounts = await solanaApi.getTokenAccountsByOwner(address, coinAddress, mainContext, subContext);

    if (!tokenAccounts || tokenAccounts.length === 0) {
      return { isInactive: false, daysSinceLastActivity: 0, category: 'No Token' };
    }

    const tokenAccountAddress = tokenAccounts[0].pubkey;
    const ataTransaction = await getFirstTransactionForATA(tokenAccountAddress, mainContext, subContext);

    if (!ataTransaction) {
      return { isInactive: false, daysSinceLastActivity: 0, category: 'No ATA Transaction' };
    }

    const lastSwapTransaction = await getLastSwapBeforeATA(address, ataTransaction.signature, mainContext, subContext);

    if (!lastSwapTransaction) {
      return { isInactive: true, daysSinceLastActivity: Infinity };
    }

    const ataCreationTime = ataTransaction.blockTime;
    const lastSwapTime = lastSwapTransaction.blockTime;
    const daysSinceLastActivity = (ataCreationTime - lastSwapTime) / (24 * 60 * 60);

    const isInactive = daysSinceLastActivity > config.INACTIVITY_THRESHOLD_DAYS;
    return { isInactive, daysSinceLastActivity };
  } catch (error) {
    logger.error(`Error checking inactivity for address: ${shortenAddress(String(address))}.`, { error });
    return { isInactive: false, daysSinceLastActivity: 0 };
  }
}

async function getFirstTransactionForATA(tokenAccountAddress, mainContext, subContext = 'checkInactivity') {
  try {
    let before = null;
    let firstTransaction = null;

    while (!firstTransaction) {
      const signatures = await solanaApi.getSignaturesForAddress(tokenAccountAddress, { limit: 1000, before }, mainContext, subContext);

      if (!signatures || signatures.length === 0) break;

      firstTransaction = signatures[signatures.length - 1];
      before = firstTransaction.signature;
    }
    return firstTransaction;
  } catch (error) {
    logger.error(`Error fetching first transaction for ATA: ${tokenAccountAddress}.`, { error });
    throw error;
  }
}

async function getLastSwapBeforeATA(ownerAddress, ataSignature, mainContext, subContext = 'checkInactivity') {
  try {
    let before = ataSignature;
    let lastSwapTransaction = null;
    let paginationToken = null;

    while (!lastSwapTransaction) {
      const signatures = await solanaApi.getSignaturesForAddress(ownerAddress, { limit: 100, before, paginationToken }, mainContext, subContext);

      if (!signatures || signatures.length === 0) break;

      for (const tx of signatures) {
        const txDetails = await solanaApi.getTransaction(tx.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }, mainContext, subContext);
        if (await isSwapTransaction(txDetails)) {
          lastSwapTransaction = tx;
          break;
        }
      }

      paginationToken = signatures[signatures.length - 1].paginationToken;
      before = signatures[signatures.length - 1].signature;
    }
    return lastSwapTransaction;
  } catch (error) {
    logger.error(`Error fetching last swap transaction before ATA for address: ${ownerAddress}.`, { error });
    throw error;
  }
}

async function isSwapTransaction(txDetails) {
  if (!txDetails || !txDetails.meta || !txDetails.meta.innerInstructions) {
    return false;
  }

  const knownSwapPrograms = [
    'DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1',
    '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP',
    'SwaPpA9LAaLfeLi3a68M4DjnLqgtticKg6CnyNwgAC8',
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'
  ];

  const usesSwapProgram = txDetails.transaction.message.accountKeys.some(key =>
    knownSwapPrograms.includes(key.pubkey)
  );

  if (usesSwapProgram) {
    return true;
  }

  for (const ix of txDetails.meta.innerInstructions) {
    for (const innerIx of ix.instructions) {
      if (innerIx.parsed && innerIx.parsed.type === 'transfer') {
        return true;
      }
    }
  }

  if (txDetails.meta.preTokenBalances && txDetails.meta.postTokenBalances) {
    const balanceChanges = txDetails.meta.postTokenBalances.some((post, index) => {
      const pre = txDetails.meta.preTokenBalances[index];
      return pre && post && pre.uiTokenAmount.uiAmount !== post.uiTokenAmount.uiAmount;
    });

    if (balanceChanges) {
      return true;
    }
  }

  return false;
}

/**
 * Shortens an address for logging purposes.
 * @param {string} address - The address to shorten.
 * @returns {string} - Shortened address.
 */
function shortenAddress(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

module.exports = { checkInactivityPeriod };
