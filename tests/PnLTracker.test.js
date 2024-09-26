const axios = require('axios');
const BigNumber = require('bignumber.js');
const { rateLimitedAxios } = require('../src/utils/rateLimiter');
const config = require('../src/utils/config');

const HELIUS_API_KEY="17c9f1f1-12e3-41e9-9d15-6143ad66e393"
const HELIUS_RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

async function main() {
    const testWalletAddress = "3pVNqLzNghGmfWpKh2wSnS2n1aPTuTc83gQDiZjjbtLD";
    
    try {
        const result = await analyzeWalletPnL(testWalletAddress);
        console.log("Analysis Result:");
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error("Error running analysis:", error);
    }
}

async function getWalletTransactions(walletAddress, startTime) {
    let transactions = [];
    let lastSignature = null;
    let apiCallCount = 0;
    
    while (true) {
        apiCallCount++;
        console.log(`API call #${apiCallCount} to get wallet transactions`);
        const response = await rateLimitedAxios({
            method: 'post',
            url: HELIUS_RPC_URL,
            data: {
                jsonrpc: '2.0',
                id: 'my-id',
                method: 'getSignaturesForAddress',
                params: [
                    walletAddress,
                    {
                        limit: 1000,
                        before: lastSignature
                    }
                ]
            }
        }, true);
        
        const newTransactions = response.data.result;
        console.log(`Received ${newTransactions ? newTransactions.length : 0} transactions in this batch`);
        
        if (!newTransactions || newTransactions.length === 0) {
            console.log(`No more transactions to fetch`);
            break;
        }
        
        const filteredTransactions = newTransactions.filter(tx => tx.blockTime >= startTime);
        console.log(`${filteredTransactions.length} transactions are within the 7-day timeframe`);
        transactions.push(...filteredTransactions);
        
        if (filteredTransactions.length < newTransactions.length) {
            console.log(`Reached transactions older than 7 days, stopping fetch`);
            break;
        }
        
        lastSignature = newTransactions[newTransactions.length - 1].signature;
        console.log(`Last signature for next batch: ${lastSignature}`);
    }
    
    return transactions;
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

    if (response.data.error) {
        throw new Error(`API Error: ${response.data.error.message}`);
    }

    console.log(`Successfully retrieved details for transaction: ${signature}`);
    return response.data.result;
}

function analyzeSwapTransaction(transaction) {
    console.log(`Analyzing transaction for swap: ${transaction.transaction.signatures[0]}`);

    const raydiumProgramId = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
    const swapInstruction = transaction.transaction.message.instructions.find(
        instr => instr.programId === raydiumProgramId
    );

    if (!swapInstruction) {
        console.log(`No swap instruction found in this transaction`);
        return null;
    }

    console.log(`Swap instruction found: ${swapInstruction.programId}`);

    // Find the relevant inner instructions
    const innerInstructions = transaction.meta.innerInstructions.find(
        inner => inner.index === transaction.transaction.message.instructions.indexOf(swapInstruction)
    );

    if (!innerInstructions || !innerInstructions.instructions) {
        console.log(`No inner instructions found for this swap`);
        return null;
    }

    // Extract token transfers
    const transfers = innerInstructions.instructions
        .filter(instr => instr.program === 'spl-token' && instr.parsed.type === 'transfer')
        .map(instr => ({
            amount: BigInt(instr.parsed.info.amount),
            source: instr.parsed.info.source,
            destination: instr.parsed.info.destination
        }));

    if (transfers.length !== 2) {
        console.log(`Unexpected number of transfers: ${transfers.length}`);
        return null;
    }

    // Determine which transfer is the token and which is SOL
    let [tokenTransfer, solTransfer] = transfers[0].amount > transfers[1].amount ? [transfers[0], transfers[1]] : [transfers[1], transfers[0]];

    console.log(`Swap details:
    Token amount: ${tokenTransfer.amount}
    SOL amount: ${solTransfer.amount}
    Token source: ${tokenTransfer.source}
    SOL destination: ${solTransfer.destination}`);

    // Determine if it's a buy or sell based on the direction of the token transfer
    const isSell = tokenTransfer.source === transaction.meta.preTokenBalances.find(balance => balance.uiTokenAmount.amount !== "0")?.accountIndex;

    return {
        tokenAmount: tokenTransfer.amount,
        solAmount: solTransfer.amount,
        isSell,
        tokenSource: tokenTransfer.source,
        solDestination: solTransfer.destination
    };
}

function updateTokenPnL(tokenPnL, swapInfo) {
    const { tokenIn, tokenOut, amountIn, amountOut } = swapInfo;

    if (tokenIn) {
        if (!tokenPnL.has(tokenIn)) {
            tokenPnL.set(tokenIn, { totalIn: 0n, totalOut: 0n });
        }
        tokenPnL.get(tokenIn).totalOut += amountIn;
    }

    if (tokenOut) {
        if (!tokenPnL.has(tokenOut)) {
            tokenPnL.set(tokenOut, { totalIn: 0n, totalOut: 0n });
        }
        tokenPnL.get(tokenOut).totalIn += amountOut;
    }

    console.log(`Updated PnL: 
    ${tokenIn}: Out ${tokenPnL.get(tokenIn)?.totalOut}
    ${tokenOut}: In ${tokenPnL.get(tokenOut)?.totalIn}`);
}

async function analyzeWalletPnL(walletAddress) {
    console.log(`Starting PnL analysis for wallet: ${walletAddress}`);
    
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
    const transactions = await getWalletTransactions(walletAddress, sevenDaysAgo);
    
    console.log(`Retrieved ${transactions.length} transactions for the last 7 days`);

    const tokenPnL = new Map();
    let totalPnLInSol = 0n;

    for (const tx of transactions) {
        const txDetails = await getTransactionDetails(tx.signature);
        console.log(`Analyzing transaction: ${tx.signature}`);
        const swapInfo = analyzeSwapTransaction(txDetails);

        if (swapInfo) {
            updateTokenPnL(tokenPnL, swapInfo);
            totalPnLInSol += swapInfo.pnlInSol;
        }
    }

    console.log('PnL Analysis Complete');
    return {
        walletAddress,
        tokenPnL: Object.fromEntries(Array.from(tokenPnL.entries()).map(([key, value]) => [key, {
            totalIn: value.totalIn.toString(),
            totalOut: value.totalOut.toString()
        }])),
        totalPnLInSol: totalPnLInSol.toString()
    };
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { analyzeWalletPnL };