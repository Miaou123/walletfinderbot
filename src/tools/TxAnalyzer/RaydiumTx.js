function analyzeRaydiumTransaction(transaction) {
    console.log("Analyzing Raydium transaction...");
  
    const userWallet = transaction.transaction.message.accountKeys[0].pubkey;
    console.log("User wallet:", userWallet);
  
    const WSOL_ADDRESS = "So11111111111111111111111111111111111111112";
    const RAYDIUM_PROGRAM_ID = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
  
    // Find the Raydium instruction
    const raydiumInstruction = transaction.transaction.message.instructions.find(
      instr => instr.programId === RAYDIUM_PROGRAM_ID
    );
  
    if (!raydiumInstruction) {
      console.log("No Raydium instruction found");
      return null;
    }
  
    console.log("Raydium instruction found");
  
    const raydiumInstructionIndex = transaction.transaction.message.instructions.indexOf(raydiumInstruction);
  
    // Find the inner instructions for the Raydium instruction
    const innerInstructions = transaction.meta.innerInstructions.find(
      inner => inner.index === raydiumInstructionIndex
    );
  
    if (!innerInstructions || !innerInstructions.instructions) {
      console.log("No inner instructions found for Raydium transaction");
      return null;
    }
  
    console.log("Inner instructions found:", innerInstructions.instructions.length);
  
    let inputTransfer = null;
    let outputTransfer = null;
  
    for (const instr of innerInstructions.instructions) {
      console.log("Analyzing inner instruction:", JSON.stringify(instr, null, 2));
      if (instr.program === "spl-token" && 
          (instr.parsed.type === "transfer" || instr.parsed.type === "transferChecked")) {
        if (instr.parsed.info.authority === userWallet || instr.parsed.info.source.includes(userWallet)) {
          inputTransfer = instr;
          console.log("Input transfer found");
        } else {
          outputTransfer = instr;
          console.log("Output transfer found");
        }
      }
    }
  
    if (!inputTransfer || !outputTransfer) {
      console.log("Couldn't identify input and output transfers");
      return null;
    }
  
    const inputAmount = BigInt(inputTransfer.parsed.info.amount || inputTransfer.parsed.info.tokenAmount?.amount || 0);
    const outputAmount = BigInt(outputTransfer.parsed.info.amount || outputTransfer.parsed.info.tokenAmount?.amount || 0);
  
    // Find the correct token mints from preTokenBalances and postTokenBalances
    const inputMint = findTokenMint(transaction, inputTransfer.parsed.info.source) || WSOL_ADDRESS;
    const outputMint = findTokenMint(transaction, outputTransfer.parsed.info.destination) || WSOL_ADDRESS;
  
    console.log("Input amount:", inputAmount.toString());
    console.log("Input mint:", inputMint);
    console.log("Output amount:", outputAmount.toString());
    console.log("Output mint:", outputMint);
  
    const isBuy = inputMint === WSOL_ADDRESS;
  
    const summary = {
      type: isBuy ? 'BUY' : 'SELL',
      buyer: userWallet,
      tokenChange: `-${inputAmount} (${inputMint})`,
      tokenChange2: `${outputAmount} (${outputMint})`,
      dex: 'Raydium'
    };
  
    console.log("Transaction Summary:", JSON.stringify(summary, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value, 2));
  
    return summary;
  }
  
  function findTokenMint(transaction, accountAddress) {
    // First, check in preTokenBalances
    const preTokenBalance = transaction.meta.preTokenBalances.find(balance => 
      balance.accountIndex === transaction.transaction.message.accountKeys.findIndex(key => key.pubkey === accountAddress)
    );
    
    if (preTokenBalance) {
      return preTokenBalance.mint;
    }
    
    // If not found in preTokenBalances, check postTokenBalances
    const postTokenBalance = transaction.meta.postTokenBalances.find(balance => 
      balance.accountIndex === transaction.transaction.message.accountKeys.findIndex(key => key.pubkey === accountAddress)
    );
    
    if (postTokenBalance) {
      return postTokenBalance.mint;
    }
  
    // If still not found, check if the account is in the transaction's account keys
    const accountIndex = transaction.transaction.message.accountKeys.findIndex(key => key.pubkey === accountAddress);
    if (accountIndex !== -1) {
      // If it's in the account keys but not in token balances, it might be a WSOL account
      return "So11111111111111111111111111111111111111112";
    }
  
    return null;
  }
  
  module.exports = { analyzeRaydiumTransaction };