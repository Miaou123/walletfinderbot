function analyzeJupiterTransaction(transaction) {

    const userWallet = transaction.transaction.message.accountKeys[0].pubkey;
  
    const WSOL_ADDRESS = "So11111111111111111111111111111111111111112";
  
    const innerInstructions = transaction.meta.innerInstructions.find(
      inner => inner.instructions.some(instr => instr.programId === "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4")
    );
  
    if (!innerInstructions) {
      return null;
    }

  
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
  
      if (instr.program === "spl-token" && (instr.parsed.type === "transfer" || instr.parsed.type === "transferChecked")) {
        if (instr.parsed.info.authority === userWallet || instr.parsed.info.source === userWallet) {
          inputTransfers.push(instr);
        } else {
          outputTransfers.push(instr);
        }
      } else if (instr.program === "system" && instr.parsed.type === "transfer") {
        if (instr.parsed.info.source === userWallet) {
          solTransfer = instr;
        } else if (instr.parsed.info.destination === userWallet) {
          outputTransfers.push(instr);
        }
      }
    }
  
    // console.log("Input transfers:", inputTransfers.length);
    // console.log("Output transfers:", outputTransfers.length);
    // console.log("SOL transfer:", solTransfer ? "Yes" : "No");
    // console.log("DEX used:", dexUsed);
  
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
  
    // console.log("Input amount:", inputAmount ? inputAmount.toString() : "N/A");
    // console.log("Input mint:", inputMint);
    // console.log("Output amount:", outputAmount ? outputAmount.toString() : "N/A");
    // console.log("Output mint:", outputMint);
  
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

  module.exports = { analyzeJupiterTransaction };