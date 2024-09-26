class ApiCallCounter {
    constructor() {
        this.contexts = {};
    }

    incrementCall(step, context = 'default') {
        if (!this.contexts[context]) {
            this.contexts[context] = { totalCalls: 0, callsByStep: {} };
        }
        this.contexts[context].totalCalls++;
        if (!this.contexts[context].callsByStep[step]) {
            this.contexts[context].callsByStep[step] = 0;
        }
        this.contexts[context].callsByStep[step]++;
    }

    resetCounter(context = 'default') {
        this.contexts[context] = { totalCalls: 0, callsByStep: {} };
    }

    getReport(context = 'default') {
        if (!this.contexts[context]) {
            return "No calls recorded for this context.";
        }
        let report = `Total API calls for ${context}: ${this.contexts[context].totalCalls}\n\nBreakdown by step:\n`;
        for (const [step, count] of Object.entries(this.contexts[context].callsByStep)) {
            report += `${step}: ${count} calls\n`;
        }
        return report;
    }
}

module.exports = new ApiCallCounter();