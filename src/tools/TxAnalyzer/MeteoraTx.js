function analyzeMeteoraTransaction(transaction) {
  console.log("Analyzing Meteora transaction...");

  const userWallet = transaction.transaction.message.accountKeys[0].pubkey;
  console.log("User wallet:", userWallet);

  const WSOL_ADDRESS = "So11111111111111111111111111111111111111112";

  // Find relevant instructions and transfers
  let { inputTransfers, outputTransfers, solTransfer } = findRelevantTransfers(transaction, userWallet);

  console.log("Input transfers:", inputTransfers.length);
  console.log("Output transfers:", outputTransfers.length);
  console.log("SOL transfer:", solTransfer ? "Yes" : "No");

  // Calculate amounts and identify mints
  let { inputAmount, outputAmount, inputMint, outputMint, isBuy } = calculateAmountsAndMints(
    transaction, inputTransfers, outputTransfers, solTransfer, userWallet, WSOL_ADDRESS
  );

  console.log("Input amount:", inputAmount ? inputAmount.toString() : "N/A");
  console.log("Input mint:", inputMint);
  console.log("Output amount:", outputAmount ? outputAmount.toString() : "N/A");
  console.log("Output mint:", outputMint);
  console.log("Is Buy:", isBuy);

  const summary = {
    type: isBuy ? 'BUY' : 'SELL',
    buyer: userWallet,
    tokenChange: `-${inputAmount} (${inputMint})`,
    tokenChange2: `${outputAmount} (${outputMint})`,
    dex: 'Meteora'
  };

  console.log("Transaction Summary:", JSON.stringify(summary, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value, 2));

  return summary;
}

function findRelevantTransfers(transaction, userWallet) {
  let inputTransfers = [];
  let outputTransfers = [];
  let solTransfer = null;

  const innerInstructions = transaction.meta.innerInstructions;

  for (const innerInstruction of innerInstructions) {
    for (const instr of innerInstruction.instructions) {
      if (instr.program === "spl-token" && (instr.parsed.type === "transfer" || instr.parsed.type === "transferChecked")) {
        if (instr.parsed.info.authority === userWallet || instr.parsed.info.source === userWallet) {
          inputTransfers.push(instr);
        } else if (instr.parsed.info.destination === userWallet) {
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
  }

  return { inputTransfers, outputTransfers, solTransfer };
}

function calculateAmountsAndMints(transaction, inputTransfers, outputTransfers, solTransfer, userWallet, WSOL_ADDRESS) {
  let inputAmount, outputAmount, inputMint, outputMint, isBuy;

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
           (transfer.parsed.info.source && findTokenMint(transaction, transfer.parsed.info.source)) ||
           WSOL_ADDRESS;
  };

  if (inputTransfers.length > 0 && outputTransfers.length > 0) {
    inputAmount = getAmount(inputTransfers[0]);
    outputAmount = getAmount(outputTransfers[0]);
    inputMint = getMint(inputTransfers[0]);
    outputMint = getMint(outputTransfers[0]);
    isBuy = outputMint !== WSOL_ADDRESS;
  } else {
    // Fallback to token balance changes if transfers are not clear
    const { inputAmount: balanceInputAmount, outputAmount: balanceOutputAmount, inputMint: balanceInputMint, outputMint: balanceOutputMint, isBuy: balanceIsBuy } = 
      calculateFromBalances(transaction, userWallet, WSOL_ADDRESS);
    
    inputAmount = balanceInputAmount;
    outputAmount = balanceOutputAmount;
    inputMint = balanceInputMint;
    outputMint = balanceOutputMint;
    isBuy = balanceIsBuy;
  }

  return { inputAmount, outputAmount, inputMint, outputMint, isBuy };
}

function calculateFromBalances(transaction, userWallet, WSOL_ADDRESS) {
  const preBalances = transaction.meta.preTokenBalances;
  const postBalances = transaction.meta.postTokenBalances;

  let inputAmount, outputAmount, inputMint, outputMint, isBuy;

  const userPreBalances = preBalances.filter(balance => balance.owner === userWallet);
  const userPostBalances = postBalances.filter(balance => balance.owner === userWallet);

  for (const preBalance of userPreBalances) {
    const postBalance = userPostBalances.find(balance => balance.mint === preBalance.mint);
    if (postBalance) {
      const preBigInt = BigInt(preBalance.uiTokenAmount.amount);
      const postBigInt = BigInt(postBalance.uiTokenAmount.amount);
      if (preBigInt > postBigInt) {
        // Token balance decreased, it's a sell
        inputAmount = preBigInt - postBigInt;
        inputMint = preBalance.mint;
        isBuy = false;
      } else if (postBigInt > preBigInt) {
        // Token balance increased, it's a buy
        outputAmount = postBigInt - preBigInt;
        outputMint = preBalance.mint;
        isBuy = true;
      }
    }
  }

  // Check SOL balance changes
  const preSOLBalance = BigInt(transaction.meta.preBalances[0]);
  const postSOLBalance = BigInt(transaction.meta.postBalances[0]);
  if (preSOLBalance > postSOLBalance) {
    inputAmount = preSOLBalance - postSOLBalance;
    inputMint = WSOL_ADDRESS;
    isBuy = true;
  } else if (postSOLBalance > preSOLBalance) {
    outputAmount = postSOLBalance - preSOLBalance;
    outputMint = WSOL_ADDRESS;
    isBuy = false;
  }

  return { inputAmount, outputAmount, inputMint, outputMint, isBuy };
}

function findTokenMint(transaction, accountAddress) {
  const tokenBalance = transaction.meta.preTokenBalances.find(balance => 
    balance.accountIndex === transaction.transaction.message.accountKeys.findIndex(key => key.pubkey === accountAddress)
  );
  
  return tokenBalance ? tokenBalance.mint : null;
}

module.exports = { analyzeMeteoraTransaction };