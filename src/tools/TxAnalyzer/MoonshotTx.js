function analyzeMoonshotTransaction(transaction) {
  console.log("Analyzing Moonshot transaction...");

  const userWallet = transaction.transaction.message.accountKeys[0].pubkey;
  console.log("User wallet:", userWallet);

  const WSOL_ADDRESS = "So11111111111111111111111111111111111111112";

  // Find the Moonshot instruction
  const moonshotInstruction = transaction.transaction.message.instructions.find(
    instr => instr.programId === "MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG"
  );

  if (!moonshotInstruction) {
    console.log("No Moonshot instruction found");
    return null;
  }

  console.log("Moonshot instruction found");

  const moonshotInstructionIndex = transaction.transaction.message.instructions.indexOf(moonshotInstruction);

  // Find the inner instructions for the Moonshot instruction
  const innerInstructions = transaction.meta.innerInstructions.find(
    inner => inner.index === moonshotInstructionIndex
  );

  if (!innerInstructions || !innerInstructions.instructions) {
    console.log("No inner instructions found for Moonshot transaction");
    return null;
  }

  let tokenTransfer = null;
  let solTransfers = [];

  for (const instr of innerInstructions.instructions) {
    if (instr.program === "spl-token" && instr.parsed.type === "transferChecked") {
      tokenTransfer = instr;
    } else if (instr.program === "system" && instr.parsed.type === "transfer") {
      solTransfers.push(instr);
    }
  }

  console.log("Token transfer:", tokenTransfer ? "Yes" : "No");
  console.log("SOL transfers:", solTransfers.length);

  let inputAmount, outputAmount, inputMint, outputMint;
  let isBuy;

  if (tokenTransfer) {
    const tokenAmount = BigInt(tokenTransfer.parsed.info.tokenAmount.amount);
    const tokenMint = tokenTransfer.parsed.info.mint;

    if (tokenTransfer.parsed.info.authority === userWallet) {
      // User is selling tokens
      inputAmount = tokenAmount;
      inputMint = tokenMint;
      isBuy = false;
    } else {
      // User is buying tokens
      outputAmount = tokenAmount;
      outputMint = tokenMint;
      isBuy = true;
    }
  }

  if (solTransfers.length > 0) {
    let totalSolSpent = BigInt(0);
    let totalSolReceived = BigInt(0);

    for (const solTransfer of solTransfers) {
      const solAmount = BigInt(solTransfer.parsed.info.lamports);
      if (solTransfer.parsed.info.source === userWallet) {
        totalSolSpent += solAmount;
      } else if (solTransfer.parsed.info.destination === userWallet) {
        totalSolReceived += solAmount;
      }
    }

    if (totalSolSpent > totalSolReceived) {
      // User is spending SOL (buying tokens)
      inputAmount = totalSolSpent;
      inputMint = WSOL_ADDRESS;
      isBuy = true;
    } else {
      // User is receiving SOL (selling tokens)
      outputAmount = totalSolReceived;
      outputMint = WSOL_ADDRESS;
      isBuy = false;
    }
  }

  // If we still couldn't determine the transaction type, check token balances
  if (inputAmount === undefined || outputAmount === undefined) {
    const preBalances = transaction.meta.preTokenBalances;
    const postBalances = transaction.meta.postTokenBalances;

    if (preBalances.length > 0 && postBalances.length > 0) {
      const userPreBalance = preBalances.find(balance => balance.owner === userWallet);
      const userPostBalance = postBalances.find(balance => balance.owner === userWallet);

      if (userPreBalance && userPostBalance) {
        const preBigInt = BigInt(userPreBalance.uiTokenAmount.amount);
        const postBigInt = BigInt(userPostBalance.uiTokenAmount.amount);

        if (postBigInt > preBigInt) {
          // User's token balance increased, it's a buy
          isBuy = true;
          inputAmount = BigInt(transaction.meta.preBalances[0] - transaction.meta.postBalances[0]); // SOL spent
          inputMint = WSOL_ADDRESS;
          outputAmount = postBigInt - preBigInt;
          outputMint = userPreBalance.mint;
        } else {
          // User's token balance decreased, it's a sell
          isBuy = false;
          inputAmount = preBigInt - postBigInt;
          inputMint = userPreBalance.mint;
          outputAmount = BigInt(transaction.meta.postBalances[0] - transaction.meta.preBalances[0]); // SOL received
          outputMint = WSOL_ADDRESS;
        }
      }
    }
  }

  console.log("Is Buy:", isBuy);
  console.log("Input amount:", inputAmount ? inputAmount.toString() : "N/A");
  console.log("Input mint:", inputMint || "N/A");
  console.log("Output amount:", outputAmount ? outputAmount.toString() : "N/A");
  console.log("Output mint:", outputMint || "N/A");

  const summary = {
    type: isBuy ? 'BUY' : 'SELL',
    buyer: userWallet,
    tokenChange: isBuy ? `-${inputAmount} (${inputMint})` : `-${outputAmount} (${outputMint})`,
    tokenChange2: isBuy ? `${outputAmount} (${outputMint})` : `${inputAmount} (${inputMint})`,
    dex: 'Moonshot'
  };

  console.log("Transaction Summary:", JSON.stringify(summary, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value, 2));

  return summary;
}

module.exports = { analyzeMoonshotTransaction };