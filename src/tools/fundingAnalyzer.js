const { getSolanaApi } = require('../integrations/solanaApi');
const logger = require('../utils/logger');
const BigNumber = require('bignumber.js');
const addressCategorization = require('../utils/addressCategorization');

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
  const analyzedWallets = [];
  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(wallet => analyzeWalletFunding(wallet, mainContext, subContext)));
    analyzedWallets.push(...batchResults);
  }

  return analyzedWallets;
}

/**
 * Analyzes the funding for a single wallet.
 * @param {Object} wallet - Wallet object containing wallet address.
 * @param {string} mainContext - The main context for API calls.
 * @param {string} subContext - The sub-context for API calls.
 * @returns {Object} - Wallet object with funder address and details.
 */
async function analyzeWalletFunding(wallet, mainContext, subContext) {
  const { address } = wallet;

  try {
    const fundingResult = await getFunderInfo(address, mainContext, subContext);
    return { 
      ...wallet, 
      funderAddress: fundingResult?.funderAddress || null,
      fundingDetails: fundingResult?.fundingDetails || null
    };
  } catch (error) {
    logger.error(`Error analyzing funding for wallet ${address}`, { error });
    return { ...wallet, error: 'Failed to analyze funding' };
  }
}

/**
 * Identifies the funder address and details for a given recipient wallet.
 * @param {string} recipientAddress - Wallet address of the recipient.
 * @param {string} mainContext - The main context for API calls.
 * @param {string} subContext - The sub-context for API calls.
 * @returns {Object|null} - Funding information or null if not found.
 */
async function getFunderInfo(recipientAddress, mainContext, subContext) {
  try {
    const signatures = await solanaApi.getSignaturesForAddress(recipientAddress, { limit: MAX_SIGNATURES }, mainContext, subContext);

    if (signatures.length >= MAX_SIGNATURES) {
      logger.warn(`Wallet ${recipientAddress} has more than ${MAX_SIGNATURES} transactions. Skipping funding analysis.`);
      return null;
    }

    // Check the earliest transactions for this wallet, as these would likely be funding transactions
    const txsToCheck = Math.min(signatures.length, MAX_TRANSACTIONS_TO_CHECK);
    const startIdx = Math.max(0, signatures.length - txsToCheck);
    
    for (let i = signatures.length - 1; i >= startIdx; i--) {
      const txInfo = signatures[i];
      const txDetails = await solanaApi.getTransaction(txInfo.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }, mainContext, subContext);
      
      const fundingInfo = analyzeTxForFunding(txDetails, recipientAddress, txInfo);
      
      if (fundingInfo) {
        // Get the name of the funder if it's a known address
        const addressInfo = addressCategorization.getAddressInfo(fundingInfo.funderAddress);
        const sourceName = addressInfo ? addressInfo.name : null;
        
        return {
          funderAddress: fundingInfo.funderAddress,
          fundingDetails: {
            amount: fundingInfo.amount,
            timestamp: txInfo.blockTime,
            date: new Date(txInfo.blockTime * 1000).toISOString(),
            signature: txInfo.signature,
            sourceName,
            sourceCategory: addressInfo ? addressInfo.category : null
          }
        };
      }
    }

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
 * @param {Object} txInfo - Transaction info object with metadata.
 * @returns {Object|null} - Funding information or null if not found.
 */
function analyzeTxForFunding(txDetails, recipientAddress, txInfo) {
  if (!txDetails || !txDetails.transaction || !txDetails.transaction.message) {
    logger.warn('Invalid transaction details received for funder analysis.');
    return null;
  }

  const { message, meta } = txDetails.transaction;
  const accountKeys = message.accountKeys;
  
  // First check if it's a system transfer
  for (const instruction of message.instructions) {
    if (instruction.parsed && instruction.parsed.type === 'transfer' && instruction.program === 'system') {
      if (instruction.parsed.info.destination === recipientAddress) {
        const funderAddress = instruction.parsed.info.source;
        const amount = new BigNumber(instruction.parsed.info.lamports).dividedBy(1e9).toNumber();
        
        return {
          funderAddress,
          amount
        };
      }
    }
  }

  // If not found in instructions, try to detect by balance change
  if (meta && meta.postBalances && meta.preBalances) {
    const recipientIndex = accountKeys.findIndex(key => key.pubkey === recipientAddress);
    
    if (recipientIndex !== -1) {
      const preBalance = meta.preBalances[recipientIndex];
      const postBalance = meta.postBalances[recipientIndex];
      
      if (postBalance > preBalance) {
        // The balance increased, find who sent the funds
        const balanceIncrease = postBalance - preBalance;
        
        for (let i = 0; i < accountKeys.length; i++) {
          if (i !== recipientIndex && meta.preBalances[i] > meta.postBalances[i]) {
            const potentialFunder = accountKeys[i].pubkey;
            const amountDecrease = meta.preBalances[i] - meta.postBalances[i];
            
            // If the decrease in this account is close to the increase in recipient
            if (Math.abs(amountDecrease - balanceIncrease) < 10000) {  // Allow for small differences like fees
              const amount = new BigNumber(balanceIncrease).dividedBy(1e9).toNumber();
              
              return {
                funderAddress: potentialFunder,
                amount
              };
            }
          }
        }
      }
    }
  }

  return null;
}

/**
 * Check if an address is a known exchange or entity
 * @param {string} address - The address to check
 * @returns {string|null} - The name of the entity or null if unknown
 */
function getKnownEntityName(address) {
  const info = addressCategorization.getAddressInfo(address);
  return info ? info.name : null;
}

module.exports = { 
  analyzeFunding, 
  getFunderInfo,
  getKnownEntityName
};