const axios = require('axios');
require('dotenv').config();

HELIUS_API_KEY="17c9f1f1-12e3-41e9-9d15-6143ad66e393"
const HELIUS_RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

async function getTransactionDetails(address, limit = 20) {
  try {
    const signaturesResponse = await axios.post(HELIUS_RPC_URL, {
      jsonrpc: '2.0',
      id: 'my-id',
      method: 'getSignaturesForAddress',
      params: [address, { limit }]
    });

    const signatures = signaturesResponse.data.result;

    for (const sig of signatures) {
      const txResponse = await axios.post(HELIUS_RPC_URL, {
        jsonrpc: '2.0',
        id: 'my-id',
        method: 'getTransaction',
        params: [
          sig.signature,
          { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }
        ]
      });

      const tx = txResponse.data.result;
      console.log('Transaction:', JSON.stringify(tx, null, 2));

      // Check for token balances
      if (tx.meta && tx.meta.postTokenBalances) {
        console.log('Post-transaction token balances:');
        tx.meta.postTokenBalances.forEach(balance => {
          console.log(`Token: ${balance.mint}, Amount: ${balance.uiTokenAmount.uiAmount}`);
        });
      }

      // Check for account keys
      if (tx.transaction && tx.transaction.message && tx.transaction.message.accountKeys) {
        console.log('Account keys involved:');
        tx.transaction.message.accountKeys.forEach(key => {
          console.log(key.pubkey);
        });
      }

      console.log('-----------------------------------');
    }
  } catch (error) {
    console.error('Error fetching transaction details:', error);
  }
}

// Usage
const walletAddress = '9zcddzV4MZR41c4CHMcyy7t8z8o8kTbGst3xi3rrbnkZ';
const coinAddress = '5bpj3W9zC2Y5Zn2jDBcYVscGnCBUN5RD7152cfL9pump';

getTransactionDetails(walletAddress).then(() => {
  console.log('Transaction details fetched and logged.');
});