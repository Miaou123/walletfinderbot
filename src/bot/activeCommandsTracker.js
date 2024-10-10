class ActiveCommandsTracker {
    constructor() {
        this.activeCommands = new Map();
    }

    addCommand(userId) {
        const userCommands = this.activeCommands.get(userId) || 0;
        if (userCommands >= 2) {
            return false;
        }
        this.activeCommands.set(userId, userCommands + 1);
        return true;
    }

    removeCommand(userId) {
        const userCommands = this.activeCommands.get(userId) || 0;
        if (userCommands > 0) {
            this.activeCommands.set(userId, userCommands - 1);
        }
    }

    getActiveCommandCount(userId) {
        return this.activeCommands.get(userId) || 0;
    }
}

module.exports = new ActiveCommandsTracker();