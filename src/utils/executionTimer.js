const { performance, PerformanceObserver } = require('perf_hooks');

class ExecutionTimer {
    constructor() {
        this.timers = {};
    }

    start(context = 'default') {
        performance.mark(`${context}-start`);
    }

    stop(context = 'default') {
        performance.mark(`${context}-end`);
        performance.measure(context, `${context}-start`, `${context}-end`);
        
        const entry = performance.getEntriesByName(context).pop();
        this.timers[context] = entry.duration;
        
        // Clear the marks and measures to keep things tidy
        performance.clearMarks(`${context}-start`);
        performance.clearMarks(`${context}-end`);
        performance.clearMeasures(context);
    }

    getExecutionTime(context = 'default') {
        return this.timers[context] || 0;
    }

    formatExecutionTime(context = 'default') {
        const ms = this.getExecutionTime(context);
        const seconds = ms / 1000;
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        if (minutes > 0) {
            return `${minutes}m ${remainingSeconds.toFixed(3)}s`;
        } else {
            return `${seconds.toFixed(3)}s`;
        }
    }

    reset(context = 'default') {
        delete this.timers[context];
    }

    resetAll() {
        this.timers = {};
    }
}

module.exports = new ExecutionTimer();