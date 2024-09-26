const config = require('../utils/config');
const { rateLimitedAxios } = require('../utils/rateLimiter');
const apiCallCounter  = require('../utils/ApiCallCounter');
const inactivityApiCounter = require('../utils/InactivityApiCounter');

async function checkInactivityPeriod(address, coinAddress) {
  try {
    // Récupérer le compte de token pour l'adresse et le coin spécifiques
    const ataResponse = await rateLimitedAxiosWithInactivityCounter({
        method: 'post',
        url: config.HELIUS_RPC_URL,
        data: {
          jsonrpc: '2.0',
          id: 'my-id',
          method: 'getTokenAccountsByOwner',
          params: [
            address,
            { mint: coinAddress },
            { encoding: 'jsonParsed' }
          ]
        }
      }, true, "Get Token Accounts");

    if (!ataResponse.data.result || !ataResponse.data.result.value || ataResponse.data.result.value.length === 0) {
      return { isInactive: false, daysSinceLastActivity: 0 };
    }

    const tokenAccountAddress = ataResponse.data.result.value[0].pubkey;

    // Trouver la première transaction pour ce compte de token
    const ataTransaction = await getFirstTransactionForATA(tokenAccountAddress);
    if (!ataTransaction) {
      return { isInactive: false, daysSinceLastActivity: 0 };
    }

    // Trouver le dernier swap avant la création de l'ATA
    const lastSwapTransaction = await getLastSwapBeforeATA(address, ataTransaction.signature);
    if (!lastSwapTransaction) {
      return { isInactive: true, daysSinceLastActivity: Infinity };
    }

    // Calculer la différence de temps
    const ataCreationTime = ataTransaction.blockTime;
    const lastSwapTime = lastSwapTransaction.blockTime;
    const daysSinceLastActivity = (ataCreationTime - lastSwapTime) / (24 * 60 * 60);

    const isInactive = daysSinceLastActivity > config.INACTIVITY_THRESHOLD_DAYS;

    //displayInactivityCheckerApiReport(); // Afficher le rapport des appels API pour l'inactivity checker

    return { isInactive, daysSinceLastActivity };
  } catch (error) {
    console.error(`Error checking inactivity period for ${address}:`, error);
    return { isInactive: false, daysSinceLastActivity: 0 };
  }
}

async function getFirstTransactionForATA(tokenAccountAddress) {
  let before = null;
  let firstTransaction = null;

  while (!firstTransaction) {
    const response = await rateLimitedAxiosWithInactivityCounter({
      method: 'post',
      url: config.HELIUS_RPC_URL,
      data: {
        jsonrpc: '2.0',
        id: 'my-id',
        method: 'getSignaturesForAddress',
        params: [
          tokenAccountAddress,
          { limit: 1000, before: before }
        ]
      }
    }, true, "Get Signatures for ATA");

    if (!response.data.result || response.data.result.length === 0) {
      break;
    }

    firstTransaction = response.data.result[response.data.result.length - 1];
    before = firstTransaction.signature;
  }

  return firstTransaction;
}

async function getLastSwapBeforeATA(ownerAddress, ataSignature) {
  let before = ataSignature;
  let lastSwapTransaction = null;
  let paginationToken = null;

  while (!lastSwapTransaction) {
    const response = await rateLimitedAxiosWithInactivityCounter({
      method: 'post',
      url: config.HELIUS_RPC_URL,
      data: {
        jsonrpc: '2.0',
        id: 'my-id',
        method: 'getSignaturesForAddress',
        params: [
          ownerAddress,
          { limit: 100, before: before, paginationToken: paginationToken }
        ]
      }
    }, true, "Get Signatures for Owner");

    if (!response.data.result || response.data.result.length === 0) {
      break;
    }

    for (let tx of response.data.result) {
      const txDetails = await getTransactionDetails(tx.signature);
      if (await isSwapTransaction(txDetails)) {
        lastSwapTransaction = tx;
        break;
      }
    }

    paginationToken = response.data.result[response.data.result.length - 1].paginationToken;
    before = response.data.result[response.data.result.length - 1].signature;
  }

  return lastSwapTransaction;
}

async function getTransactionDetails(signature) {
    const response = await rateLimitedAxiosWithInactivityCounter({
      method: 'post',
      url: config.HELIUS_RPC_URL,
      data: {
        jsonrpc: '2.0',
        id: 'my-id',
        method: 'getTransaction',
        params: [
          signature,
          { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }
        ]
      }
    }, true, "Get Transaction Details"); 

  return response.data.result;
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
      if (innerIx.parsed && innerIx.parsed.type === "transfer") {
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

async function rateLimitedAxiosWithInactivityCounter(config, isRPC, step) {
  apiCallCounter.incrementCall(step); // Incrémente le compteur global
  inactivityApiCounter.incrementCall(step); // Incrémente le compteur spécifique à l'inactivity checker
  return rateLimitedAxios(config, isRPC);
}

// Fonction pour afficher le rapport des appels API pour l'inactivity checker
function displayInactivityCheckerApiReport() {
  console.log("\nAPI Call Report for Inactivity Checker:");
  console.log(inactivityApiCounter.getReport());
}

module.exports = { checkInactivityPeriod, displayInactivityCheckerApiReport  };