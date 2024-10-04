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
            sendTransaction: 500
        };
    }

    incrementCall(api, method, mainContext = 'default', subContext = null) {
        if (!this.contexts[api]) {
            this.contexts[api] = {};
        }
        if (!this.contexts[api][mainContext]) {
            this.contexts[api][mainContext] = { totalCalls: 0, totalCredits: 0, callsByStep: {}, subContexts: {} };
        }

        const credits = this.creditCosts[method] || this.creditCosts.default;

        this.contexts[api][mainContext].totalCalls++;
        this.contexts[api][mainContext].totalCredits += credits;

        if (subContext) {
            if (!this.contexts[api][mainContext].subContexts[subContext]) {
                this.contexts[api][mainContext].subContexts[subContext] = { totalCalls: 0, totalCredits: 0, callsByStep: {} };
            }
            this.contexts[api][mainContext].subContexts[subContext].totalCalls++;
            this.contexts[api][mainContext].subContexts[subContext].totalCredits += credits;
            if (!this.contexts[api][mainContext].subContexts[subContext].callsByStep[method]) {
                this.contexts[api][mainContext].subContexts[subContext].callsByStep[method] = { calls: 0, credits: 0 };
            }
            this.contexts[api][mainContext].subContexts[subContext].callsByStep[method].calls++;
            this.contexts[api][mainContext].subContexts[subContext].callsByStep[method].credits += credits;
        } else {
            if (!this.contexts[api][mainContext].callsByStep[method]) {
                this.contexts[api][mainContext].callsByStep[method] = { calls: 0, credits: 0 };
            }
            this.contexts[api][mainContext].callsByStep[method].calls++;
            this.contexts[api][mainContext].callsByStep[method].credits += credits;
        }
    }

    getReport(api, mainContext = 'default') {
        if (!this.contexts[api] || !this.contexts[api][mainContext]) {
            return `No calls recorded for ${api} API in context ${mainContext}.`;
        }

        let report = `Detailed ${api} API Call Report:\n`;
        report += `Context: ${mainContext}\n`;
        report += `Total API calls: ${this.contexts[api][mainContext].totalCalls}\n`;
        report += `Total credits used: ${this.contexts[api][mainContext].totalCredits}\n`;
        report += `${mainContext} direct calls:\n`;

        for (const [step, data] of Object.entries(this.contexts[api][mainContext].callsByStep)) {
            report += `  ${step}: ${data.calls} calls, ${data.credits} credits\n`;
        }

        for (const [subContext, data] of Object.entries(this.contexts[api][mainContext].subContexts)) {
            report += `Sub-context: ${subContext}\n`;
            report += `  Total calls: ${data.totalCalls}\n`;
            report += `  Total credits: ${data.totalCredits}\n`;
            for (const [step, stepData] of Object.entries(data.callsByStep)) {
                report += `  ${step}: ${stepData.calls} calls, ${stepData.credits} credits\n`;
            }
        }

        return report;
    }

    resetCounter(api, mainContext = 'default') {
        if (this.contexts[api]) {
            this.contexts[api][mainContext] = { totalCalls: 0, totalCredits: 0, callsByStep: {}, subContexts: {} };
        }
    }

    logApiCalls(analysisType) {
        console.log(`\n--- API Call Reports for ${analysisType} analysis ---`);
        for (const api of ['Helius', 'GMGN', 'DexScreener']) {
            if (this.contexts[api] && this.contexts[api][analysisType]) {
                console.log(this.getDetailedReport(api, analysisType));
                console.log('-----------------------------------\n');
                this.resetCounter(api, analysisType);
            }
        }
    }

    getDetailedReport(api, mainContext) {
        if (!this.contexts[api] || !this.contexts[api][mainContext]) {
            return `No calls recorded for ${api} API in context ${mainContext}.`;
        }

        let report = `Detailed ${api} API Call Report:\n`;
        report += `Context: ${mainContext}\n`;
        report += `Total API calls: ${this.contexts[api][mainContext].totalCalls}\n`;
        report += `Total credits used: ${this.contexts[api][mainContext].totalCredits}\n`;
        
        if (Object.keys(this.contexts[api][mainContext].callsByStep).length > 0) {
            report += `${mainContext} direct calls:\n`;
            for (const [step, data] of Object.entries(this.contexts[api][mainContext].callsByStep)) {
                report += `  ${step}: ${data.calls} calls, ${data.credits} credits\n`;
            }
        }

        if (Object.keys(this.contexts[api][mainContext].subContexts).length > 0) {
            report += `Sub-context calls:\n`;
            for (const [subContext, data] of Object.entries(this.contexts[api][mainContext].subContexts)) {
                report += `  ${subContext}:\n`;
                report += `    Total calls: ${data.totalCalls}\n`;
                report += `    Total credits: ${data.totalCredits}\n`;
                for (const [step, stepData] of Object.entries(data.callsByStep)) {
                    report += `    ${step}: ${stepData.calls} calls, ${stepData.credits} credits\n`;
                }
            }
        }

        return report;
    }
}

module.exports = new ApiCallCounter();