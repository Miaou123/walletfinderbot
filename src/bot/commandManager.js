const { Worker } = require('worker_threads');
const path = require('path');
const ActiveCommandsTracker = require('./activeCommandsTracker');

class CommandManager {
    constructor() {
        this.activeWorkers = new Map();
    }

    startCommand(userId, command, args, onComplete, onError) {
        if (!ActiveCommandsTracker.addCommand(userId)) {
            throw new Error(`User ${userId} has reached the maximum number of concurrent commands.`);
        }

        const worker = new Worker(path.join(__dirname, 'commandWorker.js'), {
            workerData: { command, args }
        });

        worker.on('message', (result) => {
            onComplete(result);
            this.activeWorkers.delete(userId);
            ActiveCommandsTracker.removeCommand(userId);
        });

        worker.on('error', (error) => {
            onError(error);
            this.activeWorkers.delete(userId);
            ActiveCommandsTracker.removeCommand(userId);
        });

        worker.on('exit', (code) => {
            if (code !== 0) {
                onError(new Error(`Worker stopped with exit code ${code}`));
            }
            this.activeWorkers.delete(userId);
            ActiveCommandsTracker.removeCommand(userId);
        });

        this.activeWorkers.set(userId, worker);
    }

    cancelCommand(userId) {
        const worker = this.activeWorkers.get(userId);
        if (worker) {
            worker.terminate();
            this.activeWorkers.delete(userId);
            ActiveCommandsTracker.removeCommand(userId);
            return true;
        }
        return false;
    }

    hasActiveCommand(userId) {
        return this.activeWorkers.has(userId);
    }
}

module.exports = new CommandManager();