const { rateLimitedAxios } = require('../utils/rateLimiter');
const config = require('../utils/config');
const { getAssetsForMultipleWallets } = require('../tools/walletValueCalculator');
const { getSolanaApi } = require('../integrations/solanaApi');

const analyzeEarlyBuyers = async (tokenAddress, minPercentage = 1, timeFrameHours = 1, tokenInfo) => {
  console.log(`Starting analysis for early buyers of ${tokenAddress}...`);
  console.log(`Minimum percentage: ${minPercentage}%`);
  console.log(`Time frame: ${timeFrameHours} hours`);

  const { signatures, apiCalls, totalTransactions } = await getTokenSignatures(tokenAddress);
  console.log(`Retrieved ${signatures.length} signatures in ${apiCalls} API calls.`);

  if (signatures.length === 0) {
    console.log("No signatures found for the given token address.");
    return { earlyBuyers: [] };
  }

  const creationTime = signatures[signatures.length - 1].blockTime;
  console.log(`Token creation time: ${new Date(creationTime * 1000).toISOString()}`);

  const endTime = creationTime + (timeFrameHours * 3600);
  console.log(`End time for early buyers: ${new Date(endTime * 1000).toISOString()}`);

  const minAmountRaw = BigInt(Math.floor((tokenInfo.totalSupply * minPercentage / 100) * Math.pow(10, tokenInfo.decimals)));
  console.log(`Minimum amount (raw): ${minAmountRaw}`);

  const earlyBuyers = new Map();

  signatures.reverse();

  for (const sig of signatures) {
    if (sig.blockTime > endTime) {
      console.log(`Reached ${timeFrameHours} hour(s) after token creation. Stopping early buyers detection.`);
      break;
    }

    try {
      const solanaApi = getSolanaApi();
      const txDetails = await solanaApi.getTransaction(sig.signature);
      const tokenChange = calculateTokenChange(txDetails, tokenAddress);

      if (tokenChange > 0) {  // Only consider positive changes (buys)
        const buyer = txDetails.transaction.message.accountKeys[0].pubkey;
        const currentAmount = earlyBuyers.get(buyer)?.amount || 0n;
        const newAmount = currentAmount + tokenChange;

        earlyBuyers.set(buyer, {
          amount: newAmount,
          transactions: [
            ...(earlyBuyers.get(buyer)?.transactions || []),
            {
              signature: sig.signature,
              amount: tokenChange,
              timestamp: new Date(txDetails.blockTime * 1000).toISOString()
            }
          ]
        });

        if (newAmount >= minAmountRaw && currentAmount < minAmountRaw) {
          console.log(`Early buyer detected: ${buyer}, Cumulative Amount: ${newAmount.toString()}`);
        }
      }
    } catch (error) {
      console.error(`Error analyzing transaction ${sig.signature}:`, error);
    }
  }

  // Filter out buyers who didn't reach the minimum amount
  const qualifiedEarlyBuyers = new Map(
    Array.from(earlyBuyers.entries()).filter(([_, data]) => data.amount >= minAmountRaw)
  );

  console.log(`\nDetected ${qualifiedEarlyBuyers.size} qualified early buyers for ${tokenAddress}`);

  // Analyse des wallets en parallèle
  const earlyBuyersArray = Array.from(qualifiedEarlyBuyers, ([buyer, data]) => ({ buyer, ...data }));
  const walletAddresses = earlyBuyersArray.map(buyer => buyer.buyer);
  const walletAnalysis = await getAssetsForMultipleWallets(walletAddresses);

  // Combiner les informations des early buyers avec l'analyse des wallets
  const combinedResults = earlyBuyersArray.map(buyer => ({
    ...buyer,
    walletInfo: walletAnalysis[buyer.buyer]
  }));

  return { 
    earlyBuyers: combinedResults,
    tokenInfo 
  };
};

async function getTokenSignatures(tokenAddress) {
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
      const newSignatures = await solanaApi.getSignaturesForAddress(tokenAddress, options);
      
      if (!newSignatures || newSignatures.length === 0) {
        console.log("No more signatures available. Reached the oldest transaction.");
        break;
      }
      
      signatures.push(...newSignatures);
      totalTransactions += newSignatures.length;
      
      lastSignature = newSignatures[newSignatures.length - 1].signature;
      const lastTimestamp = new Date(newSignatures[newSignatures.length - 1].blockTime * 1000).toISOString();
      
      console.log(`API call ${apiCalls}: Fetched ${newSignatures.length} signatures. Total: ${signatures.length}`);
      console.log(`Last signature: ${lastSignature}`);
      console.log(`Last timestamp: ${lastTimestamp}`);
      
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
  
  console.log(`Total API calls: ${apiCalls}`);
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