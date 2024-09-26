const axios = require('axios');

HELIUS_API_KEY="17c9f1f1-12e3-41e9-9d15-6143ad66e393"
const HELIUS_RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;


async function analyzeSolanaTransaction(signature) {
    console.log(`Analyzing transaction: ${signature}`);
  
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
  
      if (response.data.error) {
        throw new Error(`API Error: ${response.data.error.message}`);
      }
  
      const transaction = response.data.result;
  
      if (!transaction) {
        throw new Error('Transaction not found in API response');
      }
  
      const analysis = analyzeDetailedTransaction(transaction);
  
      // Affichage des informations spécifiques demandées
      console.log('\nInformations de la transaction :');
      console.log('--------------------------------');
      console.log(`Date de la transaction : ${new Date(transaction.blockTime * 1000).toLocaleString()}`);
      console.log(`Type de transaction : ${analysis.type}`);
      console.log(`\nToken impliqué :`);
      console.log(`- Adresse : ${analysis.tokenExchanged.mint}`);
      console.log(`- Montant échangé : ${analysis.tokenExchanged.uiAmount} (${analysis.tokenExchanged.amount} raw)`);
      console.log('\nAdresses des wallets impliqués :');
      Object.entries(analysis.wallets).forEach(([role, address]) => {
        console.log(`- ${role}: ${address}`);
      });
  
    } catch (error) {
      console.error('Error analyzing transaction:', error);
      throw error;
    }
  }
  
  function analyzeDetailedTransaction(transaction) {
    const buyer = transaction.transaction.message.accountKeys[0].pubkey;
    const seller = transaction.transaction.message.accountKeys[3].pubkey;
    const tokenAccount = transaction.transaction.message.accountKeys[1].pubkey;
    const treasuryWallet = transaction.transaction.message.accountKeys[2].pubkey;
    const feeRecipient = transaction.transaction.message.accountKeys[14].pubkey;
  
    const tokenTransfer = transaction.meta.innerInstructions[1].instructions.find(
      instr => instr.parsed && instr.parsed.type === "transfer" && instr.program === "spl-token"
    );
  
    const solTransfer = transaction.meta.innerInstructions[1].instructions.find(
      instr => instr.parsed && instr.parsed.type === "transfer" && instr.program === "system" && instr.parsed.info.destination === seller
    );
  
    const platformFee = transaction.meta.innerInstructions[1].instructions.find(
      instr => instr.parsed && instr.parsed.type === "transfer" && instr.program === "system" && instr.parsed.info.destination === treasuryWallet
    );
  
    return {
      type: "Achat de token (PumpBuy)",
      wallets: {
        buyer,
        seller,
        tokenAccount,
        treasuryWallet,
        feeRecipient
      },
      tokenExchanged: {
        mint: transaction.meta.postTokenBalances[0].mint,
        amount: tokenTransfer.parsed.info.amount,
        decimals: transaction.meta.postTokenBalances[0].uiTokenAmount.decimals,
        uiAmount: parseFloat(tokenTransfer.parsed.info.amount) / Math.pow(10, transaction.meta.postTokenBalances[0].uiTokenAmount.decimals)
      },
      solanaExchanged: {
        amount: parseInt(solTransfer.parsed.info.lamports),
        uiAmount: parseInt(solTransfer.parsed.info.lamports) / 1e9
      },
      fees: {
        transactionFee: transaction.meta.fee,
        platformFee: parseInt(platformFee.parsed.info.lamports)
      }
    };
  }
  

module.exports = { analyzeSolanaTransaction };

// Usage
const signature = '5S73qqFvnM3hQDe4BK5aETpfYCS9VyENEqAgESk69nXt27CWmR7Vhb1EA4zhCCeqvsFvwEbBTbKzNhBzbZBqjCpC';


analyzeSolanaTransaction(signature).then(() => {
    console.log('Analyse de la transaction terminée.');
  }).catch(error => {
    console.error('Erreur lors de l\'analyse de la transaction:', error);
  });