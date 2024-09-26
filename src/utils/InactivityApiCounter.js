// File: src/utils/InactivityApiCounter.js

class InactivityApiCounter {
    constructor() {
        this.totalCalls = 0;
        this.callsByStep = {};
    }

    incrementCall(step) {
        this.totalCalls++;
        if (!this.callsByStep[step]) {
            this.callsByStep[step] = 0;
        }
        this.callsByStep[step]++;
    }

    getReport() {
        let report = `Total Inactivity Checker API calls: ${this.totalCalls}\n\nBreakdown by step:\n`;
        for (const [step, count] of Object.entries(this.callsByStep)) {
            report += `${step}: ${count} calls\n`;
        }
        return report;
    }
}

module.exports = new InactivityApiCounter();