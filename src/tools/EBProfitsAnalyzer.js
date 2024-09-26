const { rateLimitedAxios } = require('../utils/rateLimiter');
const { 
  analyzeJupiterTransaction,
  analyzeMeteoraTransaction,
  analyzeMoonshotTransaction,
  analyzeRaydiumTransaction,
} = require('./TxAnalyzer');
const config = require('../utils/config');

async function analyzeWalletTokenTransactions(walletAddress, tokenAddress, endTransactionSignature) {
    console.log(`Starting analysis for wallet: ${walletAddress}`);
    console.log(`Analyzing transactions for token: ${tokenAddress}`);
    console.log(`End transaction signature: ${endTransactionSignature}`);

    const signatures = await getSignaturesForAddress(walletAddress);
    console.log(`Retrieved ${signatures.length} signatures`);

    const endIndex = signatures.findIndex(sig => sig === endTransactionSignature);
    if (endIndex === -1) {
        throw new Error("Too many transactions: End transaction not found in the last 1000 signatures");
    }

    const relevantSignatures = signatures.slice(0, endIndex + 1);
    console.log(`Analyzing ${relevantSignatures.length} transactions`);

    let netSolChange = BigInt(0);
    let netTokenChange = BigInt(0);
    let totalSolInvested = BigInt(0);
    let totalSolReceived = BigInt(0);
    let tradeCount = 0;
    const transactionList = [];
    let tokenDecimals = null;

    for (const signature of relevantSignatures) {
        try {
            const transactionDetails = await getTransactionDetails(signature);

            const isTokenInvolved = transactionDetails.meta.preTokenBalances.some(balance => balance.mint === tokenAddress) ||
                transactionDetails.meta.postTokenBalances.some(balance => balance.mint === tokenAddress);

            if (!isTokenInvolved) {
                console.log(`Transaction ${signature} does not involve the specified token. Skipping.`);
                continue;
            }

            if (tokenDecimals === null) {
                tokenDecimals = getTokenDecimals(transactionDetails, tokenAddress);
                if (tokenDecimals === null) {
                    console.log(`Token decimals not found in transaction ${signature}. Skipping...`);
                    continue;
                }
            }
            
            const dex = identifyDEX(transactionDetails);
            let analysis;

            if (dex === null) {
                console.error(`No recognized DEX found for transaction ${signature}. Skipping this transaction.`);
                continue;
            }

            switch (dex) {
                case 'Jupiter':
                    analysis = analyzeJupiterTransaction(transactionDetails);
                    break;
                case 'Meteora':
                    analysis = analyzeMeteoraTransaction(transactionDetails);
                    break;
                case 'Moonshot':
                    analysis = analyzeMoonshotTransaction(transactionDetails);
                    break;
                case 'Raydium':
                    analysis = analyzeRaydiumTransaction(transactionDetails);
                    break;
            }
            
            if (analysis && (analysis.tokenChange2.includes(tokenAddress) || analysis.tokenChange.includes(tokenAddress))) {
                let solChange, tokenChange;

                if (analysis.tokenChange.includes(tokenAddress)) {
                    tokenChange = -BigInt(analysis.tokenChange.split(' ')[0]);
                    solChange = BigInt(analysis.tokenChange2.split(' ')[0]);
                } else {
                    tokenChange = BigInt(analysis.tokenChange2.split(' ')[0]);
                    solChange = -BigInt(analysis.tokenChange.split(' ')[0]);
                }

                if (analysis.type === 'BUY') {
                    netSolChange -= solChange;
                    netTokenChange += tokenChange;
                    totalSolInvested += solChange;
                } else {  // SELL
                    netSolChange += solChange;
                    netTokenChange -= tokenChange;
                    totalSolReceived += solChange;
                }

                transactionList.push({
                    signature,
                    type: analysis.type,
                    solChange: formatAmount(solChange, config.SOL_DECIMALS),
                    tokenChange: formatAmount(tokenChange, tokenDecimals),
                    dex: analysis.dex
                });

                tradeCount++;

                console.log(`Transaction ${signature}:`);
                console.log(`  Type: ${analysis.type}`);
                console.log(`  SOL change: ${formatAmount(solChange, config.SOL_DECIMALS)}`);
                console.log(`  Token change: ${formatAmount(tokenChange, tokenDecimals)}`);
                console.log(`  DEX: ${analysis.dex}`);
            }
        } catch (error) {
            console.error(`Error processing transaction ${signature}: ${error.message}`);
        }
    }

    console.log("\nAnalysis complete");
    console.log(`Wallet: ${walletAddress}`);
    console.log(`Net SOL change: ${formatAmount(netSolChange, config.SOL_DECIMALS)}`);
    console.log(`Net token change: ${formatAmount(netTokenChange, tokenDecimals)}`);
    console.log(`Total SOL invested: ${formatAmount(totalSolInvested, config.SOL_DECIMALS)}`);
    console.log(`Total SOL received: ${formatAmount(totalSolReceived, config.SOL_DECIMALS)}`);
    console.log(`Trades: ${tradeCount}`);

    return {
        wallet: walletAddress,
        netSolChange: formatAmount(netSolChange, config.SOL_DECIMALS),
        netTokenChange: formatAmount(netTokenChange, tokenDecimals),
        totalSolInvested: formatAmount(totalSolInvested, config.SOL_DECIMALS),
        totalSolReceived: formatAmount(totalSolReceived, config.SOL_DECIMALS),
        trades: tradeCount,
        transactionList
    };
}

function identifyDEX(transaction) {
    const programIds = transaction.transaction.message.instructions.map(instr => instr.programId);
    
    if (programIds.includes("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4")) return "Jupiter";
    if (programIds.includes("Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB")) return "Meteora";
    if (programIds.includes("MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG")) return "Moonshot";
    if (programIds.includes("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8")) return "Raydium";

    return null;
}

async function getSignaturesForAddress(address) {
    console.log(`Fetching signatures for address: ${address}`);
    try {
        const response = await rateLimitedAxios({
            method: 'post',
            url: config.HELIUS_RPC_URL,
            data: {
                jsonrpc: '2.0',
                id: 'my-id',
                method: 'getSignaturesForAddress',
                params: [
                    address,
                    { limit: 1000 }
                ]
            }
        }, true);

        if (response.data.error) {
            throw new Error(`API Error: ${response.data.error.message}`);
        }

        return response.data.result.map(item => item.signature);
    } catch (error) {
        console.error(`Error fetching signatures for address ${address}:`, error);
        throw error;
    }
}

async function getTransactionDetails(signature) {
    console.log(`Fetching details for transaction: ${signature}`);
    try {
        const response = await rateLimitedAxios({
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
        }, true);
        return response.data.result;
    } catch (error) {
        console.error(`Error fetching transaction details for ${signature}:`, error);
        throw error;
    }
}

function getTokenDecimals(transaction, tokenAddress) {
    const tokenAccount = transaction.meta.preTokenBalances.find(balance => balance.mint === tokenAddress);
    if (tokenAccount) {
        return tokenAccount.uiTokenAmount.decimals;
    }
    return null;
}

function formatAmount(amount, decimals) {
    const isNegative = amount < 0;
    const absoluteAmount = isNegative ? -amount : amount;
    const divisor = BigInt(10) ** BigInt(decimals);
    const integerPart = absoluteAmount / divisor;
    const fractionalPart = absoluteAmount % divisor;
    const formattedFraction = fractionalPart.toString().padStart(decimals, '0');
    const formattedAmount = `${integerPart}.${formattedFraction}`;
    return isNegative ? `-${formattedAmount}` : formattedAmount;
}

module.exports = { analyzeWalletTokenTransactions };