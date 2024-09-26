const axios = require('axios');

const HELIUS_API_KEY="17c9f1f1-12e3-41e9-9d15-6143ad66e393"
const HELIUS_RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

async function fetchTransactionDetails(signature) {
    console.log(`Fetching details for transaction: ${signature}`);
    
    try {
        const response = await axios.post(HELIUS_RPC_URL, {
            jsonrpc: '2.0',
            id: 'my-id',
            method: 'getTransaction',
            params: [
                signature,
                { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }
            ]
        });

        const transaction = response.data.result;

        console.log('Full transaction details:');
        console.log(JSON.stringify(transaction, null, 2));

        console.log('\nToken Balances:');
        console.log('Pre-transaction token balances:');
        transaction.meta.preTokenBalances.forEach(balance => {
            console.log(`  Mint: ${balance.mint}`);
            console.log(`    Owner: ${balance.owner}`);
            console.log(`    Amount: ${balance.uiTokenAmount.uiAmount}`);
        });

        console.log('Post-transaction token balances:');
        transaction.meta.postTokenBalances.forEach(balance => {
            console.log(`  Mint: ${balance.mint}`);
            console.log(`    Owner: ${balance.owner}`);
            console.log(`    Amount: ${balance.uiTokenAmount.uiAmount}`);
        });

        console.log('\nSOL Balances:');
        console.log('Pre-transaction SOL balances:');
        transaction.transaction.message.accountKeys.forEach((account, index) => {
            console.log(`  ${account.pubkey}: ${transaction.meta.preBalances[index] / 1e9} SOL`);
        });

        console.log('Post-transaction SOL balances:');
        transaction.transaction.message.accountKeys.forEach((account, index) => {
            console.log(`  ${account.pubkey}: ${transaction.meta.postBalances[index] / 1e9} SOL`);
        });

        console.log('\nInner Instructions:');
        transaction.meta.innerInstructions.forEach((inner, index) => {
            console.log(`Inner Instruction ${index}:`);
            inner.instructions.forEach((instr, i) => {
                console.log(`  Instruction ${i}:`);
                console.log(`    Program: ${instr.program}`);
                console.log(`    Parsed: ${JSON.stringify(instr.parsed, null, 2)}`);
            });
        });

    } catch (error) {
        console.error('Error fetching transaction details:', error);
    }
}



// Usage
const transactionSignature = '5S7XkcRWcEi4BZjm15Z8FsXT3Rtx2nndWhx47NXJ1hfBBjFK826DN7gtmhxS9PK92jPhJJ3JK1XNyu4xuffUvCUg';
fetchTransactionDetails(transactionSignature);