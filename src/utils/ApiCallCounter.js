class ApiCallCounter {
    constructor() {
        this.contexts = {};
        this.creditCosts = {
            default: 1,
            getProgramAccounts: 10,
            getTransaction: 10,
            getBlock: 10,
            getBlocks: 10,
            getInflationReward: 10,
            getConfirmedBlock: 10,
            getConfirmedBlocks: 10,
            getConfirmedTransaction: 10,
            getConfirmedSignaturesForAddress2: 10,
            getConfirmedSignaturesForAddress: 10,
            getSignaturesForAddress: 10,
            getBlockTime: 10,
            getAsset: 10,
            getAssetProof: 10,
            getAssetsByOwner: 10,
            getAssetsByAuthority: 10,
            getAssetsByCreator: 10,
            getAssetsByGroup: 10,
            searchAssets: 10,
            getSignaturesForAsset: 10,
            getTokenAccounts: 10,
            getNFTEditions: 10,
            getValidityProofs: 100,
            sendTransaction: 500 // Only for dedicated stake endpoint
        };
    }

    incrementCall(step, mainContext = 'default', subContext = null) {
        if (!this.contexts[mainContext]) {
            this.contexts[mainContext] = { totalCalls: 0, totalCredits: 0, callsByStep: {}, subContexts: {} };
        }

        const credits = this.creditCosts[step] || this.creditCosts.default;

        this.contexts[mainContext].totalCalls++;
        this.contexts[mainContext].totalCredits += credits;

        if (subContext) {
            if (!this.contexts[mainContext].subContexts[subContext]) {
                this.contexts[mainContext].subContexts[subContext] = { totalCalls: 0, totalCredits: 0, callsByStep: {} };
            }
            this.contexts[mainContext].subContexts[subContext].totalCalls++;
            this.contexts[mainContext].subContexts[subContext].totalCredits += credits;
            if (!this.contexts[mainContext].subContexts[subContext].callsByStep[step]) {
                this.contexts[mainContext].subContexts[subContext].callsByStep[step] = { calls: 0, credits: 0 };
            }
            this.contexts[mainContext].subContexts[subContext].callsByStep[step].calls++;
            this.contexts[mainContext].subContexts[subContext].callsByStep[step].credits += credits;
        } else {
            if (!this.contexts[mainContext].callsByStep[step]) {
                this.contexts[mainContext].callsByStep[step] = { calls: 0, credits: 0 };
            }
            this.contexts[mainContext].callsByStep[step].calls++;
            this.contexts[mainContext].callsByStep[step].credits += credits;
        }
    }

    resetCounter(mainContext = 'default') {
        this.contexts[mainContext] = { totalCalls: 0, totalCredits: 0, callsByStep: {}, subContexts: {} };
    }

    getReport(mainContext = 'default') {
        if (!this.contexts[mainContext]) {
            return "No calls recorded for this context.";
        }

        let report = `Detailed API Call Report:\n`;
        report += `Context: ${mainContext}\n`;
        report += `Total API calls: ${this.contexts[mainContext].totalCalls}\n`;
        report += `Total credits used: ${this.contexts[mainContext].totalCredits}\n`;
        report += `${mainContext} direct calls:\n`;

        for (const [step, data] of Object.entries(this.contexts[mainContext].callsByStep)) {
            report += `  ${step}: ${data.calls} calls, ${data.credits} credits\n`;
        }

        for (const [subContext, data] of Object.entries(this.contexts[mainContext].subContexts)) {
            report += `Sub-context: ${subContext}\n`;
            report += `  Total calls: ${data.totalCalls}\n`;
            report += `  Total credits: ${data.totalCredits}\n`;
            for (const [step, stepData] of Object.entries(data.callsByStep)) {
                report += `  ${step}: ${stepData.calls} calls, ${stepData.credits} credits\n`;
            }
        }

        return report;
    }

    logApiCalls(analysisType) {
        console.log(`\n--- API Call Report for ${analysisType} analysis ---`);
        console.log(this.getReport(analysisType));
        console.log('-----------------------------------\n');
        
        // Reset the counter for this context after logging
        this.resetCounter(analysisType);
    }
}

module.exports = new ApiCallCounter();