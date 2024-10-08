const { getSolanaApi } = require('../integrations/solanaApi');
const logger = require('../utils/logger'); // Utilisation de logger pour le logging

const solanaApi = getSolanaApi();

const MAX_SIGNATURES = 1000;
const MAX_TRANSACTIONS_TO_CHECK = 10;
const BATCH_SIZE = 20;

/**
 * Analyzes the funding of multiple wallets in batches.
 * @param {Array} wallets - List of wallets to analyze.
 * @param {string} mainContext - The main context for API calls.
 * @param {string} subContext - The sub-context for API calls.
 * @returns {Array} - List of wallets with analyzed funding data.
 */
async function analyzeFunding(wallets, mainContext, subContext) {
  logger.info(`Starting funding analysis for ${wallets.length} wallets`);

  const analyzedWallets = [];
  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE);
    logger.info(`Analyzing batch ${i / BATCH_SIZE + 1} of ${Math.ceil(wallets.length / BATCH_SIZE)}`);
    const batchResults = await Promise.all(batch.map(wallet => analyzeWalletFunding(wallet, mainContext, subContext)));
    analyzedWallets.push(...batchResults);
  }

  logger.info(`Funding analysis completed for ${analyzedWallets.length} wallets`);
  return analyzedWallets;
}

/**
 * Analyzes the funding for a single wallet.
 * @param {Object} wallet - Wallet object containing wallet address.
 * @param {string} mainContext - The main context for API calls.
 * @param {string} subContext - The sub-context for API calls.
 * @returns {Object} - Wallet object with funder address.
 */
async function analyzeWalletFunding(wallet, mainContext, subContext) {
  const { address } = wallet;
  logger.info(`Analyzing funding for wallet: ${address}`);

  try {
    const funderAddress = await getFunderAddress(address, mainContext, subContext);
    logger.info(`Funder found for wallet ${address}: ${funderAddress || 'None'}`);
    return { ...wallet, funderAddress };
  } catch (error) {
    logger.error(`Error analyzing funding for wallet ${address}`, { error });
    return { ...wallet, error: 'Failed to analyze funding' };
  }
}

/**
 * Identifies the funder address for a given recipient wallet.
 * @param {string} recipientAddress - Wallet address of the recipient.
 * @param {string} mainContext - The main context for API calls.
 * @param {string} subContext - The sub-context for API calls.
 * @returns {string|null} - Funder address or null if not found.
 */
async function getFunderAddress(recipientAddress, mainContext, subContext) {
  logger.info(`Analyzing funding transactions for ${recipientAddress}`);

  try {
    const signatures = await solanaApi.getSignaturesForAddress(recipientAddress, { limit: MAX_SIGNATURES }, mainContext, subContext);

    if (signatures.length >= MAX_SIGNATURES) {
      logger.warn(`Wallet ${recipientAddress} has more than ${MAX_SIGNATURES} transactions. Skipping funding analysis.`);
      return null;
    }

    for (let i = signatures.length - 1; i >= Math.max(0, signatures.length - MAX_TRANSACTIONS_TO_CHECK); i--) {
      const txDetails = await solanaApi.getTransaction(signatures[i].signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }, mainContext, subContext);
      const funderAddress = analyzeTxForFunder(txDetails, recipientAddress);

      if (funderAddress) {
        logger.info(`Funder found for recipient ${recipientAddress}: ${funderAddress}`);
        return funderAddress;
      }
    }

    logger.info(`No funder found for recipient ${recipientAddress}`);
    return null;
  } catch (error) {
    logger.error(`Error finding funder for ${recipientAddress}`, { error });
    return null;
  }
}

/**
 * Analyzes a transaction to identify a potential funder.
 * @param {Object} txDetails - Transaction details.
 * @param {string} recipientAddress - Address of the recipient.
 * @returns {string|null} - Funder address or null if not found.
 */
function analyzeTxForFunder(txDetails, recipientAddress) {
  if (!txDetails || !txDetails.transaction || !txDetails.transaction.message) {
    logger.warn('Invalid transaction details received for funder analysis.');
    return null;
  }

  const { message, meta } = txDetails.transaction;
  const accountKeys = message.accountKeys;
  const instructions = message.instructions;

  for (const instruction of instructions) {
    if (isSystemTransferToRecipient(instruction, recipientAddress)) {
      const funderAddress = instruction.parsed.info.source;
      logger.info(`System transfer found: ${funderAddress} -> ${recipientAddress}`);
      return funderAddress;
    }
  }

  if (meta && meta.postBalances && meta.preBalances) {
    return detectFunderByBalanceChange(meta, accountKeys, recipientAddress);
  }

  logger.info(`No relevant transfer or balance change found in transaction for ${recipientAddress}`);
  return null;
}

/**
 * Detects if a transaction instruction is a system transfer to the specified recipient.
 * @param {Object} instruction - Transaction instruction.
 * @param {string} recipientAddress - Address of the recipient.
 * @returns {boolean} - Returns true if the instruction is a system transfer to the recipient.
 */
function isSystemTransferToRecipient(instruction, recipientAddress) {
  return (
    instruction.program === 'system' &&
    instruction.parsed &&
    instruction.parsed.type === 'transfer' &&
    instruction.parsed.info.destination === recipientAddress
  );
}

/**
 * Detects the funder by analyzing the balance changes in the transaction.
 * @param {Object} meta - Metadata of the transaction.
 * @param {Array} accountKeys - List of account keys in the transaction.
 * @param {string} recipientAddress - Address of the recipient.
 * @returns {string|null} - Funder address or null if not found.
 */
function detectFunderByBalanceChange(meta, accountKeys, recipientAddress) {
  for (let i = 0; i < accountKeys.length; i++) {
    if (accountKeys[i].pubkey === recipientAddress) {
      if (meta.postBalances[i] > meta.preBalances[i]) {
        logger.info(`Balance increase detected for ${recipientAddress}`);
        for (let j = 0; j < accountKeys.length; j++) {
          if (meta.postBalances[j] < meta.preBalances[j]) {
            const potentialFunder = accountKeys[j].pubkey;
            logger.info(`Potential funder identified: ${potentialFunder}`);
            return potentialFunder;
          }
        }
      }
      break;
    }
  }
  return null;
}

module.exports = { analyzeFunding };
