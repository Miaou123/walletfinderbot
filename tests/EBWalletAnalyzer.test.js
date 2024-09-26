const axios = require('axios');

const HELIUS_API_KEY="17c9f1f1-12e3-41e9-9d15-6143ad66e393"
const HELIUS_RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;


const SOL_DECIMALS = 9;

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

    let totalSolChange = BigInt(0);
    let totalTokenChange = BigInt(0);
    const transactionList = [];
    let tokenDecimals = null;

    for (const signature of relevantSignatures) {
        try {
            const transactionDetails = await getTransactionDetails(signature);
            
            // Get token decimals if not already set
            if (tokenDecimals === null) {
                tokenDecimals = getTokenDecimals(transactionDetails, tokenAddress);
                if (tokenDecimals === null) {
                    console.log(`Token decimals not found in transaction ${signature}. Skipping...`);
                    continue;
                }
            }
            
            const analysis = analyzeTransaction(transactionDetails, tokenAddress, walletAddress);
            
            if (analysis) {
                totalSolChange += analysis.solChange;
                totalTokenChange += analysis.tokenChange;
                transactionList.push({
                    signature,
                    type: analysis.type,
                    solChange: formatAmount(analysis.solChange, SOL_DECIMALS),
                    tokenChange: formatAmount(analysis.tokenChange, tokenDecimals)
                });

                console.log(`Transaction ${signature}:`);
                console.log(`  Type: ${analysis.type}`);
                console.log(`  SOL change: ${formatAmount(analysis.solChange, SOL_DECIMALS)}`);
                console.log(`  Token change: ${formatAmount(analysis.tokenChange, tokenDecimals)}`);
            }
        } catch (error) {
            console.error(`Error processing transaction ${signature}: ${error.message}`);
        }
    }

    console.log("\nAnalysis complete");
    console.log(`Total SOL change: ${formatAmount(totalSolChange, SOL_DECIMALS)}`);
    console.log(`Total token change: ${formatAmount(totalTokenChange, tokenDecimals)}`);

    return {
        transactionList,
        totalSolChange: formatAmount(totalSolChange, SOL_DECIMALS),
        totalTokenChange: formatAmount(totalTokenChange, tokenDecimals)
    };
}

async function getSignaturesForAddress(address) {
    console.log(`Fetching signatures for address: ${address}`);
    const response = await axios.post(HELIUS_RPC_URL, {
        jsonrpc: '2.0',
        id: 'my-id',
        method: 'getSignaturesForAddress',
        params: [
            address,
            { limit: 1000 }
        ]
    });
    return response.data.result.map(item => item.signature);
}

async function getTransactionDetails(signature) {
    console.log(`Fetching details for transaction: ${signature}`);
    const response = await axios.post(HELIUS_RPC_URL, {
        jsonrpc: '2.0',
        id: 'my-id',
        method: 'getTransaction',
        params: [
            signature,
            { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }
        ]
    });
    return response.data.result;
}

function analyzeTransaction(transaction, tokenAddress, walletAddress) {
    console.log(`Analyzing transaction: ${transaction.transaction.signatures[0]}`);

    // Check if the token is involved in this transaction
    const isTokenInvolved = transaction.meta.preTokenBalances.some(balance => balance.mint === tokenAddress) ||
                            transaction.meta.postTokenBalances.some(balance => balance.mint === tokenAddress);

    if (!isTokenInvolved) {
        console.log(`Token ${tokenAddress} not involved in this transaction. Skipping.`);
        return null;
    }

    console.log(`Token ${tokenAddress} found in transaction. Proceeding with analysis.`);

    const raydiumProgramId = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
    const swapInstruction = transaction.transaction.message.instructions.find(
        instr => instr.programId === raydiumProgramId
    );

    if (!swapInstruction) {
        console.log(`No Raydium swap instruction found in this transaction`);
        return null;
    }

    console.log(`Raydium swap instruction found: ${swapInstruction.programId}`);

    const preBalances = new Map(transaction.meta.preTokenBalances.map(balance => [balance.mint, balance]));
    const postBalances = new Map(transaction.meta.postTokenBalances.map(balance => [balance.mint, balance]));

    const preSolBalance = BigInt(transaction.meta.preBalances[transaction.transaction.message.accountKeys.findIndex(key => key.pubkey === walletAddress)]);
    const postSolBalance = BigInt(transaction.meta.postBalances[transaction.transaction.message.accountKeys.findIndex(key => key.pubkey === walletAddress)]);
    
    const preTokenBalance = BigInt(preBalances.get(tokenAddress)?.uiTokenAmount.amount || 0);
    const postTokenBalance = BigInt(postBalances.get(tokenAddress)?.uiTokenAmount.amount || 0);

    let solChange = postSolBalance - preSolBalance;
    let tokenChange = postTokenBalance - preTokenBalance;

       // If token change is zero, check inner instructions
    if (tokenChange === 0n) {
        console.log("Token change is zero. Checking inner instructions...");
        const innerInstructions = transaction.meta.innerInstructions.find(
            inner => inner.index === transaction.transaction.message.instructions.indexOf(swapInstruction)
        );

        if (innerInstructions && innerInstructions.instructions) {
            // Find the instruction with Raydium pool authority
            const raydiumTransfer = innerInstructions.instructions.find(instr => 
                instr.parsed?.type === "transfer" && 
                instr.program === "spl-token" &&
                instr.parsed.info.authority !== walletAddress
            );

            if (raydiumTransfer) {
                tokenChange = BigInt(raydiumTransfer.parsed.info.amount);
                console.log(`Found token transfer in inner instructions: ${tokenChange.toString()}`);
            }
        }
    }


    // Determine if it's a buy or sell
    const isSell = tokenChange < 0;

    console.log(`Swap details:
    Type: ${isSell ? 'SELL' : 'BUY'}
    Token Change: ${tokenChange.toString()}
    SOL Change: ${solChange.toString()}
    `);

    return {
        type: isSell ? 'SELL' : 'BUY',
        tokenChange: tokenChange,
        solChange: solChange,
    };
}

function getTokenDecimals(transaction, tokenAddress) {
    const tokenAccount = transaction.meta.preTokenBalances.find(balance => balance.mint === tokenAddress);
    if (tokenAccount) {
        return tokenAccount.uiTokenAmount.decimals;
    }
    throw new Error(`Token account for ${tokenAddress} not found in transaction`);
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

// Usage example
async function main() {
    const walletAddress = '3pVNqLzNghGmfWpKh2wSnS2n1aPTuTc83gQDiZjjbtLD';
    const tokenAddress = 'FByURDd8tBowyyXrodGXqZfnpwTiEVmfRHgmmNSRpump';
    const endTransactionSignature = '3BQiruXvYfb3cSqUsgCS12hhtEK7bUHuhC7ZCoqnm2fRt6N9QcdUey562SwDSpWKN542Gc9nXDdyqzJt4NWqF1qT';

    try {
        const result = await analyzeWalletTokenTransactions(walletAddress, tokenAddress, endTransactionSignature);
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error("Error:", error.message);
    }
}

main();