const axios = require('axios');
const fs = require('fs');

// Chemin du fichier où les logs seront enregistrés
const logFilePath = 'transaction_logs.txt';

// Fonction pour écrire les logs dans le fichier
function logToFile(message) {
    fs.appendFile(logFilePath, message + '\n', (err) => {
        if (err) throw err;
    });
}


const HELIUS_API_KEY="17c9f1f1-12e3-41e9-9d15-6143ad66e393"
const HELIUS_RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

async function getTransactionDetails(transactionHash) {
  try {
    const response = await axios.post(HELIUS_RPC_URL, {
      jsonrpc: '2.0',
      id: 'my-id',
      method: 'getTransaction',
      params: [
        transactionHash,
        { maxSupportedTransactionVersion: 0, encoding: 'jsonParsed' }
      ],
    });
    return response.data.result;
  } catch (error) {
    console.error('Error fetching transaction details:', error);
    return null;
  }
}

function analyzeJupiterTransaction(transaction) {
    console.log("Analyzing Jupiter transaction...");
  
    const userWallet = transaction.transaction.message.accountKeys[0].pubkey;
    console.log("User wallet:", userWallet);
  
    const WSOL_ADDRESS = "So11111111111111111111111111111111111111112";
  
    const innerInstructions = transaction.meta.innerInstructions.find(
      inner => inner.instructions.some(instr => instr.programId === "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4")
    );
  
    if (!innerInstructions) {
      console.log("No Jupiter instructions found");
      return null;
    }
  
    console.log("Number of inner instructions:", innerInstructions.instructions.length);
  
    let inputTransfers = [];
    let outputTransfers = [];
    let dexUsed = "Unknown";
    let solTransfer = null;
  
    // Check all instructions in the transaction for DEX identification
    const allInstructions = [
      ...transaction.transaction.message.instructions,
      ...innerInstructions.instructions
    ];
  
    for (const instr of allInstructions) {
      if (instr.programId === "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo" || 
          instr.programId === "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB") {
        dexUsed = "Meteora";
        break;
      } else if (instr.programId === "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8") {
        dexUsed = "Raydium";
        break;
      }
    }
  
    for (const instr of innerInstructions.instructions) {
      console.log("Analyzing instruction:", JSON.stringify(instr, null, 2));
  
      if (instr.program === "spl-token" && (instr.parsed.type === "transfer" || instr.parsed.type === "transferChecked")) {
        if (instr.parsed.info.authority === userWallet || instr.parsed.info.source === userWallet) {
          inputTransfers.push(instr);
          console.log("Input transfer detected");
        } else {
          outputTransfers.push(instr);
          console.log("Output transfer detected");
        }
      } else if (instr.program === "system" && instr.parsed.type === "transfer") {
        if (instr.parsed.info.source === userWallet) {
          solTransfer = instr;
          console.log("SOL transfer out detected");
        } else if (instr.parsed.info.destination === userWallet) {
          outputTransfers.push(instr);
          console.log("SOL transfer in detected");
        }
      }
    }
  
    console.log("Input transfers:", inputTransfers.length);
    console.log("Output transfers:", outputTransfers.length);
    console.log("SOL transfer:", solTransfer ? "Yes" : "No");
    console.log("DEX used:", dexUsed);
  
    const getAmount = (transfer) => {
      if (transfer.parsed.info.tokenAmount) {
        return BigInt(transfer.parsed.info.tokenAmount.amount);
      } else if (transfer.parsed.info.amount) {
        return BigInt(transfer.parsed.info.amount);
      }
      return BigInt(transfer.parsed.info.lamports || 0);
    };
  
    const getMint = (transfer) => {
      if (transfer.program === "system") {
        return WSOL_ADDRESS;
      }
      return transfer.parsed.info.mint || 
             (transfer.parsed.info.source && transaction.meta.preTokenBalances.find(bal => bal.accountIndex === transaction.transaction.message.accountKeys.findIndex(key => key.pubkey === transfer.parsed.info.source))?.mint) ||
             WSOL_ADDRESS; // Default to WSOL if unknown
    };
  
    let inputAmount, outputAmount, inputMint, outputMint;
  
    if (solTransfer) {
      inputAmount = BigInt(solTransfer.parsed.info.lamports);
      inputMint = WSOL_ADDRESS;
      if (outputTransfers.length > 0) {
        outputAmount = getAmount(outputTransfers[outputTransfers.length - 1]);
        outputMint = getMint(outputTransfers[outputTransfers.length - 1]);
      }
    } else if (inputTransfers.length > 0 && outputTransfers.length > 0) {
      inputAmount = inputTransfers.reduce((sum, transfer) => sum + getAmount(transfer), 0n);
      outputAmount = getAmount(outputTransfers[outputTransfers.length - 1]);
      inputMint = getMint(inputTransfers[0]);
      outputMint = getMint(outputTransfers[outputTransfers.length - 1]);
    } else {
      console.log("Could not identify input and output transfers");
      return null;
    }
  
    // Ensure WSOL address is used if input mint is unknown
    if (inputMint === "Unknown") {
      inputMint = WSOL_ADDRESS;
    }
  
    console.log("Input amount:", inputAmount ? inputAmount.toString() : "N/A");
    console.log("Input mint:", inputMint);
    console.log("Output amount:", outputAmount ? outputAmount.toString() : "N/A");
    console.log("Output mint:", outputMint);
  
    const isBuy = outputMint !== WSOL_ADDRESS;
  
    const summary = {
      type: isBuy ? 'BUY' : 'SELL',
      buyer: userWallet,
      tokenChange: `-${inputAmount} (${inputMint})`,
      tokenChange2: `${outputAmount} (${outputMint})`,
      dex: `Jupiter (via ${dexUsed})`
    };
  
    console.log("Transaction Summary:", JSON.stringify(summary, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value, 2));
  
    return summary;
  }


  async function main(transactionHash) {
    const transactionDetails = await getTransactionDetails(transactionHash);
    if (transactionDetails) {
      analyzeJupiterTransaction(transactionDetails);
    } else {
      console.log("Failed to retrieve transaction details");
    }
  }
  
  // Usage
  const transactionHash = '5S7XkcRWcEi4BZjm15Z8FsXT3Rtx2nndWhx47NXJ1hfBBjFK826DN7gtmhxS9PK92jPhJJ3JK1XNyu4xuffUvCUg';
  //41whAUcNVowgUx2smtcLUjfqzWxrC8wcmwzWw69XE5EEi6tygprggZLHorDmoa4eP1FyuktViZBSWLPR6yNyFzfU
//5S7XkcRWcEi4BZjm15Z8FsXT3Rtx2nndWhx47NXJ1hfBBjFK826DN7gtmhxS9PK92jPhJJ3JK1XNyu4xuffUvCUg
  main(transactionHash);