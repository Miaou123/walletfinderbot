const { fetchMultipleWallets } = require('../tools/walletChecker');
const { getSolanaApi } = require('../integrations/solanaApi');

const analyzeEarlyBuyers = async (tokenAddress, minPercentage = 1, timeFrameHours = 1, tokenInfo, mainContext = 'default') => {
  const solanaApi = getSolanaApi();
  console.log(`Starting analysis for ${tokenAddress}`);

  const { signatures, apiCalls, totalTransactions } = await getTokenSignatures(tokenAddress, mainContext);
  console.log(`Retrieved ${signatures.length} signatures in ${apiCalls} API calls`);

  if (signatures.length === 0) {
    console.log("No signatures found");
    return { earlyBuyers: [] };
  }

  const creationTime = signatures[signatures.length - 1].blockTime;
  const endTime = creationTime + (timeFrameHours * 3600);
  console.log(`Token creation: ${new Date(creationTime * 1000).toISOString()}`);
  console.log(`End time: ${new Date(endTime * 1000).toISOString()}`);

  const minAmountRaw = BigInt(Math.floor((tokenInfo.totalSupply * minPercentage / 100) * Math.pow(10, tokenInfo.decimals)));

  const earlyBuyers = new Map();
  let reachedEndTime = false;
  const batchSize = 20;

  // Process signatures in reverse order (oldest to newest)
  signatures.reverse();

  for (let i = 0; i < signatures.length && !reachedEndTime; i += batchSize) {
    const batch = signatures.slice(i, i + batchSize);
    console.log(`Processing batch ${i / batchSize + 1}`);

    const batchPromises = batch.map(sig => processSingleTransaction(sig, tokenAddress, endTime, minAmountRaw, earlyBuyers, mainContext));
    const batchResults = await Promise.all(batchPromises);

    if (batchResults.some(result => result.reachedEndTime)) {
      console.log('Reached endTime, stopping analysis');
      reachedEndTime = true;
    }
  }

  const qualifiedEarlyBuyers = new Map(
    Array.from(earlyBuyers.entries()).filter(([_, data]) => data.amount >= minAmountRaw)
  );

  console.log(`Detected ${qualifiedEarlyBuyers.size} qualified early buyers`);

  // Use fetchMultipleWallets instead of getAssetsForMultipleWallets
  const walletAddresses = Array.from(qualifiedEarlyBuyers.keys());
  const walletAnalysis = await fetchMultipleWallets(walletAddresses, 5, mainContext, 'fetchEarlyBuyers');

  const combinedResults = Array.from(qualifiedEarlyBuyers, ([buyer, data]) => {
    const walletData = walletAnalysis.find(w => w.wallet === buyer);
    return {
      buyer,
      ...data,
      walletInfo: walletData ? walletData.data.data : null
    };
  });

  return { 
    earlyBuyers: combinedResults,
    tokenInfo 
  };
};

async function processSingleTransaction(sig, tokenAddress, endTime, minAmountRaw, earlyBuyers, mainContext) {
  if (sig.blockTime > endTime) {
    return { reachedEndTime: true };
  }

  try {
    const solanaApi = getSolanaApi();
    const txDetails = await solanaApi.getTransaction(sig.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }, mainContext, 'getTransaction');
    const tokenChange = calculateTokenChange(txDetails, tokenAddress);

    if (tokenChange > 0) {
      const buyer = txDetails.transaction.message.accountKeys[0].pubkey;
      updateEarlyBuyers(earlyBuyers, buyer, tokenChange, sig, txDetails.blockTime, minAmountRaw);
    }
  } catch (error) {
    console.error(`Error processing ${sig.signature}`);
  }

  return { reachedEndTime: false };
}

function updateEarlyBuyers(earlyBuyers, buyer, tokenChange, sig, blockTime, minAmountRaw) {
  const currentData = earlyBuyers.get(buyer) || { amount: 0n, transactions: [] };
  const newAmount = currentData.amount + tokenChange;

  const updatedData = {
    amount: newAmount,
    transactions: [
      ...currentData.transactions,
      {
        signature: sig.signature,
        amount: tokenChange,
        timestamp: new Date(blockTime * 1000).toISOString()
      }
    ]
  };

  earlyBuyers.set(buyer, updatedData);

  if (newAmount >= minAmountRaw && currentData.amount < minAmountRaw) {
    console.log(`New early buyer: ${buyer.slice(0, 8)}... Amount: ${newAmount.toString()}`);
  }
}

async function getTokenSignatures(tokenAddress, mainContext) {
  const solanaApi = getSolanaApi();
  let signatures = [];
  let lastSignature = null;
  let apiCalls = 0;
  let totalTransactions = 0;
  
  while (true) {
    apiCalls++;
    try {
      const options = {
        limit: 1000,
        before: lastSignature
      };
      const newSignatures = await solanaApi.getSignaturesForAddress(tokenAddress, options, mainContext, 'getSignatures');
      
      if (!newSignatures || newSignatures.length === 0) {
        console.log("No more signatures available. Reached the oldest transaction.");
        break;
      }
      
      signatures.push(...newSignatures);
      totalTransactions += newSignatures.length;
      
      lastSignature = newSignatures[newSignatures.length - 1].signature;
      const lastTimestamp = new Date(newSignatures[newSignatures.length - 1].blockTime * 1000).toISOString();
      
      const oldestAllowedTimestamp = new Date('2020-01-01').getTime();
      if (newSignatures[newSignatures.length - 1].blockTime * 1000 < oldestAllowedTimestamp) {
        console.log("Reached transactions older than the allowed date. Stopping.");
        break;
      }
    } catch (error) {
      console.error("Error fetching signatures:", error);
      break;
    }
  }
  
  console.log(`Total transactions fetched: ${totalTransactions}`);
  
  return { signatures, apiCalls, totalTransactions };
}

function calculateTokenChange(transaction, tokenAddress) {
  const preBalance = BigInt(transaction.meta.preTokenBalances.find(b => b.mint === tokenAddress)?.uiTokenAmount.amount || 0);
  const postBalance = BigInt(transaction.meta.postTokenBalances.find(b => b.mint === tokenAddress)?.uiTokenAmount.amount || 0);
  return postBalance - preBalance;
}

module.exports = {
  analyzeEarlyBuyers
};