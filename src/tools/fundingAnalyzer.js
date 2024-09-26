const { rateLimitedAxios } = require('../utils/rateLimiter');
const apiCallCounter = require('../utils/ApiCallCounter');
const config = require('../utils/config');
const executionTimer = require('../utils/executionTimer');

const MAX_SIGNATURES = 1000;
const MAX_TRANSACTIONS_TO_CHECK = 10;
const BATCH_SIZE = 20;

async function analyzeFunding(wallets) {
    executionTimer.start('funding');
    apiCallCounter.resetCounter('funding');

    const analyzedWallets = [];
    for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
        const batch = wallets.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(analyzeWalletFunding));
        analyzedWallets.push(...batchResults);
    }

    const groupedWallets = groupWalletsByFunder(analyzedWallets);
    const apiCallReport = apiCallCounter.getReport('funding');
    executionTimer.stop('funding');

    const executionTime = executionTimer.getExecutionTime('funding');
    console.log(`Temps d'exécution : ${executionTimer.formatExecutionTime('funding')}`);

    return { groupedWallets, apiCallReport, executionTime };
}

async function analyzeWalletFunding(wallet) {
    try {
        const funderAddress = await getFunderAddress(wallet.address);
        return { ...wallet, funderAddress };
    } catch (error) {
        console.error(`Error analyzing funding for wallet ${wallet.address}:`, error);
        return { ...wallet, error: 'Failed to analyze funding' };
    }
}

async function getFunderAddress(recipientAddress) {
    try {
        const { signatures, hasMoreThanMaxSignatures } = await getSignaturesForAddress(recipientAddress);
        
        if (hasMoreThanMaxSignatures) {
            console.log(`Wallet ${recipientAddress} has more than ${MAX_SIGNATURES} transactions. Skipping funding analysis.`);
            return null;
        }

        for (let i = signatures.length - 1; i >= 0; i--) {
            const txDetails = await getTransactionDetails(signatures[i].signature);
            const funderAddress = analyzeTxForFunder(txDetails, recipientAddress);
            
            if (funderAddress) {
                return funderAddress;
            }

            if (i <= signatures.length - MAX_TRANSACTIONS_TO_CHECK) {
                break;
            }
        }
        
        return null;
    } catch (error) {
        console.error(`Error finding funder for ${recipientAddress}:`, error);
        return null;
    }
}

async function getSignaturesForAddress(address) {
    const response = await rateLimitedAxios({
        method: 'post',
        url: config.HELIUS_RPC_URL,
        data: {
            jsonrpc: '2.0',
            id: 'signatures',
            method: 'getSignaturesForAddress',
            params: [address, { limit: MAX_SIGNATURES }]
        }
    }, true);

    apiCallCounter.incrementCall("Get Signatures for Funding Analysis", 'funding');
    const signatures = response.data.result;
    return {
        signatures: signatures,
        hasMoreThanMaxSignatures: signatures.length >= MAX_SIGNATURES
    };
}

async function getTransactionDetails(signature) {
    const response = await rateLimitedAxios({
        method: 'post',
        url: config.HELIUS_RPC_URL,
        data: {
            jsonrpc: '2.0',
            id: 'tx-details',
            method: 'getTransaction',
            params: [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]
        }
    }, true);

    apiCallCounter.incrementCall("Get Transaction Details for Funding Analysis", 'funding');
    return response.data.result;
}

function analyzeTxForFunder(txDetails, recipientAddress) {
    if (!txDetails || !txDetails.transaction || !txDetails.transaction.message) {
        return null;
    }

    const message = txDetails.transaction.message;
    const instructions = message.instructions;

    for (const instruction of instructions) {
        if (instruction.program === 'system' && instruction.parsed.type === 'transfer') {
            const { info } = instruction.parsed;
            if (info.destination === recipientAddress) {
                return info.source;
            }
        }
    }

    return null;
}

function groupWalletsByFunder(walletAnalysis) {
    const groups = {};
    walletAnalysis.forEach(wallet => {
        if (wallet.funderAddress) {
            if (!groups[wallet.funderAddress]) {
                groups[wallet.funderAddress] = [];
            }
            groups[wallet.funderAddress].push(wallet);
        }
    });
    return Object.entries(groups).filter(([_, wallets]) => wallets.length >= 3);
}

module.exports = { analyzeFunding };