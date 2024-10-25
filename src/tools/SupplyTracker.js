const BigNumber = require('bignumber.js');
const { getSolanaApi } = require('../integrations/solanaApi');
const logger = require('../utils/logger'); 
const solanaApi = getSolanaApi();
const fs = require('fs').promises;
const path = require('path');

const CHECK_INTERVAL = 1 * 60 * 1000;
const SAVE_INTERVAL = 0.5 * 60 * 1000;
const CLEANUP_INTERVAL = 1 * 60 * 60 * 1000;  
const EXPIRY_TIME = 48 * 60 * 60 * 1000;   

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function retryWithBackoff(operation, maxRetries = 5, initialDelay = 1000) {
    let retries = 0;
    while (retries < maxRetries) {
        try {
            return await operation();
        } catch (err) {
            if (retries === maxRetries - 1) throw err;

            const delay = initialDelay * Math.pow(2, retries);
            logger.warn(`Retry attempt ${retries + 1}. Waiting ${delay}ms before next attempt.`);
            await wait(delay);
            retries++;
        }
    }
}

class SupplyTracker {
    constructor(bot, accessControl) {
        this.userTrackers = new Map();
        this.bot = bot;
        this.accessControl = accessControl;
        this.saveFilePath = path.join(__dirname, '../data/trackers.json');
        this.saveInterval = setInterval(() => this.saveTrackers(), SAVE_INTERVAL);
        this.cleanupInterval = setInterval(() => this.cleanupExpiredTrackers(), CLEANUP_INTERVAL);
    }

    async cleanupExpiredTrackers() {
        const now = Date.now();
        let trackersRemoved = 0;

        logger.debug('Starting cleanup check...'); // Log de debug pour le test

        for (const [username, trackers] of this.userTrackers.entries()) {
            for (const [trackerId, tracker] of trackers.entries()) {
                const age = now - tracker.startTimestamp;
                logger.debug(`Checking tracker ${trackerId} - Age: ${age / 1000}s / ${EXPIRY_TIME / 1000}s`); // Log de debug

                if (age > EXPIRY_TIME) {
                    logger.debug(`Removing expired tracker ${trackerId} for user ${username}`); // Log de debug
                    await this.notifyExpiry(tracker);
                    this.stopTracking(username, trackerId);
                    trackersRemoved++;
                }
            }
        }

        if (trackersRemoved > 0) {
            logger.debug(`Cleaned up ${trackersRemoved} expired trackers`);
            await this.saveTrackers();
        }
    }

    async init() {
        try {
            await this.loadTrackers();
            // Vérifie immédiatement les trackers expirés au démarrage
            await this.cleanupExpiredTrackers();
        } catch (error) {
            logger.error('Failed to initialize SupplyTracker:', error);
            throw new Error('SupplyTracker initialization failed');
        }
    }

    async notifyExpiry(tracker) {
        const message = `⌛ Tracking expired for ${tracker.ticker}\n\n` +
                       `The ${tracker.trackType} supply tracking has been automatically stopped after 48 hours.\n` +
                       `If you want to continue tracking, please start a new tracking session.`;
        try {
            await this.bot.sendMessage(tracker.chatId, message);
        } catch (error) {
            logger.error(`Failed to send expiry notification for ${tracker.ticker}:`, error);
        }
    }

    async saveTrackers() {
        const trackersData = {};
        for (const [username, trackers] of this.userTrackers.entries()) {
            trackersData[username] = Array.from(trackers.entries()).map(([trackerId, tracker]) => ({
                trackerId,
                chatId: tracker.chatId,
                wallets: tracker.wallets,
                initialSupplyPercentage: tracker.initialSupplyPercentage.toString(),
                currentSupplyPercentage: tracker.currentSupplyPercentage.toString(),
                totalSupply: tracker.totalSupply.toString(),
                significantChangeThreshold: tracker.significantChangeThreshold.toString(),
                ticker: tracker.ticker,
                decimals: tracker.decimals,
                trackType: tracker.trackType,
                tokenAddress: tracker.tokenAddress,
                startTimestamp: tracker.startTimestamp // Ajout du timestamp
            }));
        }
        try {
            await fs.writeFile(this.saveFilePath, JSON.stringify(trackersData, null, 2));
        } catch (error) {
            logger.error('Error saving trackers:', error);
        }
    }

    async loadTrackers() {
        try {
            const data = await fs.readFile(this.saveFilePath, 'utf8');
            const trackersData = JSON.parse(data);
            const now = Date.now();
            logger.debug(`Creating new tracker with timestamp ${now} - Will expire at ${new Date(now + EXPIRY_TIME)}`);
    
            for (const [username, trackers] of Object.entries(trackersData)) {
                const userTrackers = new Map();
                for (const tracker of trackers) {
                    // Ignore les trackers déjà expirés
                    if (now - tracker.startTimestamp > EXPIRY_TIME) {
                        logger.debug(`Skipping expired tracker ${tracker.trackerId} during load`);
                        continue;
                    }
                    
                    const restoredTracker = {
                        ...tracker,
                        initialSupplyPercentage: new BigNumber(tracker.initialSupplyPercentage),
                        currentSupplyPercentage: new BigNumber(tracker.currentSupplyPercentage),
                        totalSupply: new BigNumber(tracker.totalSupply),
                        significantChangeThreshold: new BigNumber(tracker.significantChangeThreshold),
                        startTimestamp: tracker.startTimestamp,
                        intervalId: setInterval(() => this.checkSupply(username, tracker.trackerId), CHECK_INTERVAL)
                    };
                    userTrackers.set(tracker.trackerId, restoredTracker);
                }
                if (userTrackers.size > 0) { 
                    this.userTrackers.set(username, userTrackers);
                }
            }
            logger.debug('Trackers loaded successfully');
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.debug('No saved trackers found. Starting with empty tracker list.');
            } else {
                logger.error('Error loading trackers:', error);
            }
        }
    }

    startTracking(tokenAddress, chatId, wallets, initialSupplyPercentage, totalSupply, significantChangeThreshold, ticker, decimals, trackType, username) {
        logger.debug(`Starting tracking for user ${username}:`, { tokenAddress, chatId, wallets, initialSupplyPercentage, totalSupply, significantChangeThreshold, ticker, decimals, trackType });
        
        if (!this.userTrackers.has(username)) {
            this.userTrackers.set(username, new Map());
        }

        const userTrackers = this.userTrackers.get(username);
        const userRole = this.accessControl.getUserRole(username);

        let maxTrackers;
        if (userRole === 'admin') {
            maxTrackers = Infinity;
        } else if (userRole === 'vip') {
            maxTrackers = 10;
        } else {
            maxTrackers = 2;
        }

        if (userTrackers.size >= maxTrackers) {
            throw new Error(`You've reached your maximum number of simultaneous trackings (${maxTrackers}). Please stop an existing tracking with /tracker before starting a new one.`);
        }

        const trackerId = `${tokenAddress}_${trackType}`;

        if (userTrackers.has(trackerId)) {
            throw new Error(`Already tracking ${trackType} for ${tokenAddress}`);
        }

        const now = Date.now();
        logger.debug(`Creating new tracker with timestamp ${now} - Will expire at ${new Date(now + EXPIRY_TIME)}`);
        

        const tracker = {
            chatId,
            wallets,
            initialSupplyPercentage: new BigNumber(initialSupplyPercentage),
            currentSupplyPercentage: new BigNumber(initialSupplyPercentage),
            totalSupply: new BigNumber(totalSupply),
            significantChangeThreshold: new BigNumber(significantChangeThreshold),
            ticker,
            decimals,
            trackType,
            tokenAddress,
            username,
            startTimestamp: now,
            intervalId: setInterval(() => this.checkSupply(username, trackerId), CHECK_INTERVAL)
        };

        userTrackers.set(trackerId, tracker);
    }

    stopTracking(username, trackerId) {
        const userTrackers = this.userTrackers.get(username);
        if (!userTrackers) {
            logger.debug(`No trackers found for user ${username}`);
            return false;
        }

        const tracker = userTrackers.get(trackerId);
        if (!tracker) {
            logger.debug(`No tracker found for ID ${trackerId} of user ${username}`);
            return false;
        }

        clearInterval(tracker.intervalId);
        userTrackers.delete(trackerId);

        if (userTrackers.size === 0) {
            this.userTrackers.delete(username);
        }

        return true;
    }

    getTrackedSuppliesByUser(username) {
        const userTrackers = this.userTrackers.get(username);
        if (!userTrackers) {
            logger.debug(`No trackers found for user ${username}`);
            return [];
        }

        return Array.from(userTrackers.entries()).map(([trackerId, tracker]) => ({
            trackerId,
            tokenAddress: tracker.tokenAddress,
            ticker: tracker.ticker,
            currentSupplyPercentage: tracker.currentSupplyPercentage.toFixed(2),
            trackType: tracker.trackType,
            significantChangeThreshold: tracker.significantChangeThreshold.toFixed(2)
        }));
    }

    async checkSupply(username, trackerId) {
        logger.debug(`Checking supply for ${username}, trackerId: ${trackerId}`);
        const userTrackers = this.userTrackers.get(username);
        if (!userTrackers) {
            logger.debug(`No trackers found for user ${username}`);
            return;
        }

        const tracker = userTrackers.get(trackerId);
        logger.debug(`Current tracker info:`, tracker);
        if (!tracker) {
            logger.debug(`No tracker found for ID ${trackerId} of user ${username}`);
            return;
        }

        try {
            await retryWithBackoff(async () => {
                let newSupplyPercentage;
                if (tracker.trackType === 'team') {
                    newSupplyPercentage = await this.getTeamSupply(tracker.wallets, tracker.tokenAddress, tracker.totalSupply, tracker.decimals);
                } else {
                    newSupplyPercentage = await this.getControlledSupply(tracker.wallets, tracker.tokenAddress, tracker.totalSupply, tracker.decimals);
                }

                if (newSupplyPercentage.isNaN() || !newSupplyPercentage.isFinite()) {
                    throw new Error(`Invalid supply percentage calculated for ${tracker.tokenAddress} (${tracker.trackType})`);
                }

                const change = newSupplyPercentage.minus(tracker.initialSupplyPercentage);

                if (change.abs().isGreaterThanOrEqualTo(tracker.significantChangeThreshold)) {
                    await this.notifyChange(tracker, newSupplyPercentage, change);
                    tracker.initialSupplyPercentage = newSupplyPercentage;
                }

                tracker.currentSupplyPercentage = newSupplyPercentage;
            });
        } catch (error) {
            logger.error(`Error checking ${tracker.trackType} supply for ${tracker.tokenAddress} after multiple retries:`, { 
                error: error.message,
                stack: error.stack,
                tokenAddress: tracker.tokenAddress,
                trackType: tracker.trackType
            });
        }
    }

    async getTokenBalance(walletAddress, tokenAddress, mainContext, subContext) {
        return retryWithBackoff(async () => {
            try {
                if (!walletAddress || !tokenAddress) {
                    logger.warn(`Invalid wallet address or token address: ${walletAddress}, ${tokenAddress}`);
                    return new BigNumber(0);
                }

                const tokenAccounts = await solanaApi.getTokenAccountsByOwner(walletAddress, tokenAddress, mainContext, subContext);

                if (tokenAccounts && tokenAccounts.length > 0 && tokenAccounts[0].account?.data?.parsed?.info?.tokenAmount?.amount) {
                    const balance = new BigNumber(tokenAccounts[0].account.data.parsed.info.tokenAmount.amount);
                    return balance;
                }

                logger.warn(`No valid token account found for wallet ${walletAddress} and token ${tokenAddress}`);
                return new BigNumber(0);
            } catch (error) {
                logger.error(`Error getting token balance for ${walletAddress}:`, { error });
                throw error;
            }
        });
    }


    async getControlledSupply(controllingWallets, tokenAddress, totalSupply, decimals, mainContext, subContext) {
        logger.debug(`Calculating controlled supply for ${tokenAddress}:`, { wallets: controllingWallets, totalSupply, decimals });
        if (!controllingWallets || controllingWallets.length === 0) {
            logger.warn(`No controlling wallets found for ${tokenAddress}. Returning 0.`);
            return new BigNumber(0);
        }
    
        // Modifiez cette ligne :
        const balances = await Promise.all(controllingWallets.map(wallet => {
            if (typeof wallet === 'string') {
                return this.getTokenBalance(wallet, tokenAddress, mainContext, subContext);
            } else if (wallet && wallet.address) {
                return this.getTokenBalance(wallet.address, tokenAddress, mainContext, subContext);
            } else {
                logger.warn(`Invalid wallet structure: ${JSON.stringify(wallet)}`);
                return new BigNumber(0);
            }
        }));
        
        const totalBalance = balances.reduce((total, balance) => total.plus(balance.dividedBy(new BigNumber(10).pow(decimals))), new BigNumber(0));
        const supplyPercentage = totalBalance.dividedBy(totalSupply).multipliedBy(100);
        logger.debug(`Total controlled balance: ${totalBalance.toString()}, Supply percentage: ${supplyPercentage.toFixed(2)}%`);
        return supplyPercentage;
    }
    
    async getTeamSupply(teamWallets, tokenAddress, totalSupply, decimals, mainContext, subContext) {
        logger.debug(`Calculating team supply for ${tokenAddress}:`, { wallets: teamWallets, totalSupply, decimals });
        if (!teamWallets || teamWallets.length === 0) {
            logger.warn(`No team wallets found for ${tokenAddress}. Returning 0.`);
            return new BigNumber(0);
        }
    
        const balances = await Promise.all(teamWallets.map(wallet => this.getTokenBalance(wallet, tokenAddress, mainContext, subContext)));
        const totalBalance = balances.reduce((total, balance) => total.plus(balance.dividedBy(new BigNumber(10).pow(decimals))), new BigNumber(0));
        const supplyPercentage = totalBalance.dividedBy(totalSupply).multipliedBy(100);
        logger.debug(`Total team balance: ${totalBalance.toString()}, Supply percentage: ${supplyPercentage.toFixed(2)}%`);
        return supplyPercentage;
    }    

    async notifyChange(tracker, newPercentage, change) {
        const emoji = change.isGreaterThan(0) ? "📈" : "📉";
        const message = `⚠️ Significant change detected in ${tracker.trackType} supply for ${tracker.ticker}\n\n` +
                        `${tracker.trackType === 'team' ? 'Team' : 'Top holders'} now hold ${newPercentage.toFixed(2)}% (previously ${tracker.initialSupplyPercentage.toFixed(2)}%)\n\n` +
                        `${emoji} ${change.isGreaterThan(0) ? '+' : ''}${change.toFixed(2)}%`;
        try {
            await this.bot.sendMessage(tracker.chatId, message);
        } catch (error) {
            logger.error(`Failed to send notification for ${tracker.ticker}:`, error);
        }
    }

    async notifyError(tracker, error) {
        const errorMessage = `⚠️ Error occurred while tracking ${tracker.trackType} supply for ${tracker.ticker}\n\n` +
                             `Error: ${error.message}\n\n` +
                             `Tracking will continue, but you may want to check the tracked supply again.`;
        try {
            await this.bot.sendMessage(tracker.chatId, errorMessage);
        } catch (sendError) {
            logger.error(`Failed to send error notification for ${tracker.ticker}:`, sendError);
        }
    }
}

module.exports = SupplyTracker;