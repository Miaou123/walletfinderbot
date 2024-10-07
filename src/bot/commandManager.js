const { Worker } = require('worker_threads');
const path = require('path');

class CommandManager {
    constructor() {
        this.activeWorkers = new Map(); // Stocke les Workers actifs par utilisateur
    }

    startCommand(userId, command, args, onComplete, onError) {
        // Si une commande est déjà en cours, on la refuse
        if (this.activeWorkers.has(userId)) {
            throw new Error(`User ${userId} already has an active command.`);
        }

        // Initialiser un nouveau Worker avec la commande
        const worker = new Worker(path.join(__dirname, 'commandWorker.js'), {
            workerData: { command, args }
        });

        worker.on('message', (result) => {
            onComplete(result);
            this.activeWorkers.delete(userId); // Supprimer le Worker terminé
        });

        worker.on('error', (error) => {
            onError(error);
            this.activeWorkers.delete(userId); // Supprimer le Worker en cas d'erreur
        });

        worker.on('exit', (code) => {
            if (code !== 0) {
                onError(new Error(`Worker stopped with exit code ${code}`));
            }
            this.activeWorkers.delete(userId);
        });

        this.activeWorkers.set(userId, worker);
    }

    cancelCommand(userId) {
        const worker = this.activeWorkers.get(userId);
        if (worker) {
            worker.terminate();
            this.activeWorkers.delete(userId);
            return true;
        }
        return false;
    }

    hasActiveCommand(userId) {
        return this.activeWorkers.has(userId);
    }
}

module.exports = new CommandManager();
