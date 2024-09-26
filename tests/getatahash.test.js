
//programme qui récupère l'ata d'un coin puis cherche le dernier swap effectué par le wallet et retourne le temps qui s'est écoulé entre les deux 

async function getFirstTransactionForATA(apiKey, ownerAddress, mintAddress) {
    try {
        console.log(`Fetching token accounts for owner: ${ownerAddress} and mint: ${mintAddress}`);
        const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
            method: 'POST',
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "jsonrpc": "2.0",
                "id": "1",
                "method": "getTokenAccountsByOwner",
                "params": [
                    ownerAddress,
                    {
                        "mint": mintAddress
                    },
                    {
                        "encoding": "jsonParsed"
                    }
                ]
            }),
        });

        const data = await response.json();
        if (!data.result.value || data.result.value.length === 0) {
            throw new Error("Aucun compte token trouvé pour cette adresse et ce mint.");
        }

        const tokenAccountAddress = data.result.value[0].pubkey;
        console.log(`Token account address: ${tokenAccountAddress}`);

        let before = null;
        let firstTransaction = null;

        while (!firstTransaction) {
            console.log(`Fetching transactions for token account: ${tokenAccountAddress}, before: ${before}`);
            const responseTx = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
                method: 'POST',
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    "jsonrpc": "2.0",
                    "id": "1",
                    "method": "getConfirmedSignaturesForAddress2",
                    "params": [
                        tokenAccountAddress,
                        {
                            "limit": 1000,
                            "before": before
                        }
                    ]
                }),
            });

            const transactions = await responseTx.json();
            if (!transactions.result || transactions.result.length === 0) {
                break;
            }

            console.log(`Found ${transactions.result.length} transactions`);
            firstTransaction = transactions.result[transactions.result.length - 1];
            before = firstTransaction.signature;
        }

        console.log(`First transaction found: ${firstTransaction.signature}`);
        return firstTransaction;

    } catch (error) {
        console.error("Erreur:", error.message);
    }
}
async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getTransactionDetails(apiKey, signature) {
    console.log(`Fetching details for transaction: ${signature}`);
    const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
        method: 'POST',
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            "jsonrpc": "2.0",
            "id": "1",
            "method": "getTransaction",
            "params": [
                signature,
                { "encoding": "jsonParsed", "maxSupportedTransactionVersion": 0 }
            ]
        }),
    });

    const transaction = await response.json();
    if (transaction.error) {
        console.error(`Error fetching transaction details for ${signature}: ${transaction.error.message}`);
    }
    return transaction.result;
}
async function isSwapTransaction(txDetails) {
    if (!txDetails || !txDetails.meta || !txDetails.meta.innerInstructions) {
        return false;
    }

    // Liste des programmes de swap connus
    const knownSwapPrograms = [
        'DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1', // Raydium
        '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP', // Orca
        'SwaPpA9LAaLfeLi3a68M4DjnLqgtticKg6CnyNwgAC8', // Serum Swap
        '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium Swap v2
        // Ajoutez d'autres programmes de swap connus ici
    ];

    // Vérifier si l'un des programmes de swap connus est utilisé
    const usesSwapProgram = txDetails.transaction.message.accountKeys.some(key => 
        knownSwapPrograms.includes(key.pubkey)
    );

    if (usesSwapProgram) {
        console.log("Transaction uses a known swap program");
        return true;
    }

    // Vérifier les instructions internes pour des opérations de swap
    for (const ix of txDetails.meta.innerInstructions) {
        for (const innerIx of ix.instructions) {
            if (innerIx.parsed && innerIx.parsed.type === "transfer") {
                console.log("Found a transfer instruction, potential swap");
                return true;
            }
        }
    }

    // Vérifier les changements de solde de tokens
    if (txDetails.meta.preTokenBalances && txDetails.meta.postTokenBalances) {
        const balanceChanges = txDetails.meta.postTokenBalances.some((post, index) => {
            const pre = txDetails.meta.preTokenBalances[index];
            return pre && post && pre.uiTokenAmount.uiAmount !== post.uiTokenAmount.uiAmount;
        });

        if (balanceChanges) {
            console.log("Detected token balance changes, potential swap");
            return true;
        }
    }

    return false;
}

async function getLastSwapBeforeATA(apiKey, ownerAddress, ataSignature) {
    try {
        let before = ataSignature;
        let lastSwapTransaction = null;
        let paginationToken = null;

        while (!lastSwapTransaction) {
            console.log(`Fetching transactions for wallet: ${ownerAddress}, before: ${before}`);
            const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
                method: 'POST',
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    "jsonrpc": "2.0",
                    "id": "1",
                    "method": "getSignaturesForAddress",
                    "params": [
                        ownerAddress,
                        {
                            "limit": 100,
                            "before": before,
                            "paginationToken": paginationToken
                        }
                    ]
                }),
            });

            const transactions = await response.json();
            if (!transactions.result || transactions.result.length === 0) {
                console.log("No more transactions found.");
                break;
            }

            console.log(`Checking ${transactions.result.length} transactions for swap operations`);
            for (let tx of transactions.result) {
                console.log(`Checking transaction: ${tx.signature}`);
                const txDetails = await getTransactionDetails(apiKey, tx.signature);
                
                await delay(100);

                if (await isSwapTransaction(txDetails)) {
                    console.log(`Swap found in transaction: ${tx.signature}`);
                    lastSwapTransaction = tx;
                    break;
                }
            }

            paginationToken = transactions.result[transactions.result.length - 1].paginationToken;
            before = transactions.result[transactions.result.length - 1].signature;
        }

        if (!lastSwapTransaction) {
            console.log("No swap transaction found before the ATA creation.");
        }

        return lastSwapTransaction;

    } catch (error) {
        console.error("Erreur:", error.message);
    }
}

async function compareTimestamps(apiKey, ownerAddress, mintAddress) {
    try {
        console.log("Starting process to find the first ATA transaction and the last swap before it...");
        const ataTransaction = await getFirstTransactionForATA(apiKey, ownerAddress, mintAddress);
        if (!ataTransaction) {
            console.log("Impossible de trouver la transaction de création de l'ATA.");
            return;
        }

        const lastSwapTransaction = await getLastSwapBeforeATA(apiKey, ownerAddress, ataTransaction.signature);
        if (!lastSwapTransaction) {
            console.log("Aucun swap trouvé avant la création de l'ATA.");
            return;
        }

        const ataDetails = await getTransactionDetails(apiKey, ataTransaction.signature);
        const swapDetails = await getTransactionDetails(apiKey, lastSwapTransaction.signature);

        if (ataDetails && swapDetails) {
            const ataTimestamp = ataDetails.blockTime;
            const swapTimestamp = swapDetails.blockTime;

            const timeDiff = ataTimestamp - swapTimestamp;
            const timeDiffInSeconds = Math.abs(timeDiff);

            console.log(`Temps écoulé entre le dernier swap et la création de l'ATA : ${timeDiffInSeconds} secondes`);
        } else {
            console.log("Impossible de récupérer les détails des transactions pour comparer les timestamps.");
        }

    } catch (error) {
        console.error("Erreur:", error.message);
    }
}

// Appel de la fonction principale avec les paramètres spécifiques
const apiKey = '17c9f1f1-12e3-41e9-9d15-6143ad66e393';
const ownerAddress = '9Q2iQTt6wPSCF3PddwWgMJceFmgtKa9Dqz3MSyhYp35D';
const mintAddress = '5bpj3W9zC2Y5Zn2jDBcYVscGnCBUN5RD7152cfL9pump';

compareTimestamps(apiKey, ownerAddress, mintAddress);
