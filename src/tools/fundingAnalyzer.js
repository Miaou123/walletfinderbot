const config = require('../utils/config');
const { getSolanaApi } = require('../integrations/solanaApi');

const solanaApi = getSolanaApi();

const MAX_SIGNATURES = 1000;
const MAX_TRANSACTIONS_TO_CHECK = 10;
const BATCH_SIZE = 20;

async function analyzeFunding(wallets, mainContext, subContext) {
    console.log(`Starting funding analysis for ${wallets.length} wallets`);

    const analyzedWallets = [];
    for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
        const batch = wallets.slice(i, i + BATCH_SIZE);
        console.log(`Analyzing batch ${i / BATCH_SIZE + 1} of ${Math.ceil(wallets.length / BATCH_SIZE)}`);
        const batchResults = await Promise.all(batch.map(wallet => analyzeWalletFunding(wallet, mainContext, subContext)));
        analyzedWallets.push(...batchResults);
    }
    const groupedWallets = groupWalletsByFunder(analyzedWallets);
    console.log(`Funding analysis completed. Found ${groupedWallets.length} groups of wallets with common funders`);
    return { groupedWallets };
}

async function analyzeWalletFunding(wallet, mainContext, subContext) {
    console.log(`Analyzing funding for wallet: ${wallet.address}`);
    try {
        const funderAddress = await getFunderAddress(wallet.address, mainContext, subContext);
        console.log(`Funder found for ${wallet.address}: ${funderAddress || 'None'}`);
        return { ...wallet, funderAddress };
    } catch (error) {
        console.error(`Error analyzing funding for wallet ${wallet.address}:`, error);
        return { ...wallet, error: 'Failed to analyze funding' };
    }
}

async function getFunderAddress(recipientAddress, mainContext, subContext) {
    console.log(`Analyzing funding for ${recipientAddress}`);
    try {
        const signatures = await solanaApi.getSignaturesForAddress(recipientAddress, { limit: MAX_SIGNATURES }, mainContext, subContext);
        
        if (signatures.length >= MAX_SIGNATURES) {
            console.log(`Wallet ${recipientAddress} has more than ${MAX_SIGNATURES} transactions. Skipping funding analysis.`);
            return null;
        }

        for (let i = signatures.length - 1; i >= Math.max(0, signatures.length - MAX_TRANSACTIONS_TO_CHECK); i--) {
            const txDetails = await solanaApi.getTransaction(signatures[i].signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }, mainContext, subContext);
            const funderAddress = analyzeTxForFunder(txDetails, recipientAddress);
            
            if (funderAddress) {
                console.log(`Funder found for ${recipientAddress}: ${funderAddress}`);
                return funderAddress;
            }
        }
        
        console.log(`No funder found for ${recipientAddress}`);
        return null;
    } catch (error) {
        console.error(`Error finding funder for ${recipientAddress}:`, error);
        return null;
    }
}

function analyzeTxForFunder(txDetails, recipientAddress) {
    if (!txDetails || !txDetails.transaction || !txDetails.transaction.message) {
        console.log('Invalid transaction details');
        return null;
    }

    const message = txDetails.transaction.message;
    const accountKeys = message.accountKeys;
    const instructions = message.instructions;

    for (const instruction of instructions) {
        if (instruction.program === 'system' && instruction.parsed && instruction.parsed.type === 'transfer') {
            const { info } = instruction.parsed;
            if (info.destination === recipientAddress) {
                console.log(`Transfer found: ${info.source} -> ${info.destination}`);
                return info.source;
            }
        }
    }

    if (txDetails.meta && txDetails.meta.postBalances && txDetails.meta.preBalances) {
        for (let i = 0; i < accountKeys.length; i++) {
            if (accountKeys[i].pubkey === recipientAddress) {
                if (txDetails.meta.postBalances[i] > txDetails.meta.preBalances[i]) {
                    console.log(`Balance increase detected for ${recipientAddress}`);
                    for (let j = 0; j < accountKeys.length; j++) {
                        if (txDetails.meta.postBalances[j] < txDetails.meta.preBalances[j]) {
                            console.log(`Potential funder found: ${accountKeys[j].pubkey}`);
                            return accountKeys[j].pubkey;
                        }
                    }
                }
                break;
            }
        }
    }

    console.log('No relevant transfer or balance change found in transaction');
    return null;
}

function groupWalletsByFunder(walletAnalysis) {
    console.log(`Grouping ${walletAnalysis.length} wallets by funder`);
    const groups = {};
    walletAnalysis.forEach(wallet => {
        if (wallet.funderAddress) {
            if (!groups[wallet.funderAddress]) {
                groups[wallet.funderAddress] = [];
            }
            groups[wallet.funderAddress].push(wallet);
        }
    });
    const filteredGroups = Object.entries(groups).filter(([_, wallets]) => wallets.length >= 3);
    console.log(`Found ${filteredGroups.length} groups with 3 or more wallets`);
    return filteredGroups;
}

module.exports = { analyzeFunding };