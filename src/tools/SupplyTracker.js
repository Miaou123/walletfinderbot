const BigNumber = require('bignumber.js');
const { getSolanaApi } = require('../integrations/solanaApi');

const solanaApi = getSolanaApi();

const CHECK_INTERVAL = 1 * 60 * 1000; 

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function retryWithBackoff(operation, maxRetries = 5, initialDelay = 1000) {
    let retries = 0;
    while (retries < maxRetries) {
        try {
            return await operation();
        } catch (err) {
            if (retries === maxRetries - 1) throw err;
            
            const delay = initialDelay * Math.pow(2, retries);
            console.log(`Retry attempt ${retries + 1}. Waiting ${delay}ms before next attempt.`);
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
    }

    startTracking(tokenAddress, chatId, wallets, initialSupplyPercentage, totalSupply, significantChangeThreshold, ticker, decimals, trackType, username) {
        console.log('SupplyTracker.startTracking called with params:');
        console.log('Token Address:', tokenAddress);
        console.log('ChatId:', chatId);
        console.log('Wallets:', JSON.stringify(wallets, null, 2));
        console.log('Initial Supply Percentage:', initialSupplyPercentage);
        console.log('Total Supply:', totalSupply);
        console.log('Significant Change Threshold:', significantChangeThreshold);
        console.log('Ticker:', ticker);
        console.log('Decimals:', decimals);
        console.log('Track Type:', trackType);
        console.log('Username:', username);
        console.log(`Starting tracking with parameters:`, {
            tokenAddress, chatId, wallets, initialSupplyPercentage, totalSupply,
            significantChangeThreshold, ticker, decimals, trackType, username
        });
        if (!this.userTrackers.has(username)) {
            this.userTrackers.set(username, new Map());
        }
        
        const userTrackers = this.userTrackers.get(username);

        // Obtenir le rôle de l'utilisateur
        const userRole = this.accessControl.getUserRole(username);

        let maxTrackers;
        if (userRole === 'admin') {
            maxTrackers = Infinity; // Pas de limite pour les admins
        } else if (userRole === 'vip') {
            maxTrackers = 10;
        } else {
            maxTrackers = 2; // Limite par défaut pour les utilisateurs normaux
        }

        if (userTrackers.size >= maxTrackers) {
            throw new Error(`You've reached your maximum number of simultaneous trackings (${maxTrackers}). Please stop an existing tracking with /tracker before starting a new one.`);
        }

        const trackerId = `${tokenAddress}_${trackType}`;
        
        if (userTrackers.has(trackerId)) {
            throw new Error(`Already tracking ${trackType} for ${tokenAddress}`);
        }

        // Vérifier si wallets est un tableau et non vide
        if (!Array.isArray(wallets) || wallets.length === 0) {
            console.warn(`No ${trackType} wallets provided for ${tokenAddress}. This may cause issues with tracking.`);
        }

        const tracker = {
            chatId,
            wallets: wallets,
            initialSupplyPercentage: new BigNumber(initialSupplyPercentage),
            currentSupplyPercentage: new BigNumber(initialSupplyPercentage),
            totalSupply: new BigNumber(totalSupply),
            significantChangeThreshold: new BigNumber(significantChangeThreshold),
            ticker,
            decimals,
            trackType,
            tokenAddress,
            username,
            intervalId: setInterval(() => this.checkSupply(username, trackerId), CHECK_INTERVAL)
        };

        userTrackers.set(trackerId, tracker);
        console.log(`Started ${trackType} tracking for ${tokenAddress} by user ${username}. Initial supply: ${initialSupplyPercentage}%, Threshold: ${significantChangeThreshold}%, Wallets count: ${tracker.wallets.length}`);
    }

    stopTracking(username, trackerId) {
        const userTrackers = this.userTrackers.get(username);
        if (!userTrackers) return false;

        const tracker = userTrackers.get(trackerId);
        if (!tracker) return false;

        clearInterval(tracker.intervalId);
        userTrackers.delete(trackerId);

        if (userTrackers.size === 0) {
            this.userTrackers.delete(username);
        }

        return true;
    }

    getTrackedSuppliesByUser(username) {
        const userTrackers = this.userTrackers.get(username);
        if (!userTrackers) return [];

        return Array.from(userTrackers.entries()).map(([trackerId, tracker]) => ({
            trackerId,
            tokenAddress: tracker.tokenAddress,
            ticker: tracker.ticker,
            currentSupplyPercentage: tracker.currentSupplyPercentage.toFixed(2),
            trackType: tracker.trackType
        }));
    }

    async checkSupply(username, trackerId) {
        const userTrackers = this.userTrackers.get(username);
        if (!userTrackers) {
            console.warn(`No trackers found for user ${username}`);
            return;
        }
        
        const tracker = userTrackers.get(trackerId);
        if (!tracker) {
            console.warn(`No tracker found for ID ${trackerId} of user ${username}`);
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
    
                if (newSupplyPercentage.isNaN()) {
                    throw new Error(`Invalid supply percentage calculated for ${tracker.tokenAddress} (${tracker.trackType})`);
                }
    
                const change = newSupplyPercentage.minus(tracker.initialSupplyPercentage);
    
                console.log(`Check for ${tracker.tokenAddress} (${tracker.trackType}): Current supply: ${newSupplyPercentage.toFixed(2)}%, Initial: ${tracker.initialSupplyPercentage.toFixed(2)}%, Change: ${change.toFixed(2)}%`);
    
                if (change.abs().isGreaterThanOrEqualTo(tracker.significantChangeThreshold)) {
                    await this.notifyChange(tracker, newSupplyPercentage, change);
                    tracker.initialSupplyPercentage = newSupplyPercentage;
                    console.log(`Significant change detected for ${tracker.trackType}. New initial supply set to: ${newSupplyPercentage.toFixed(2)}%`);
                }
    
                tracker.currentSupplyPercentage = newSupplyPercentage;
            });
        } catch (error) {
            console.error(`Error checking ${tracker.trackType} supply for ${tracker.tokenAddress} after multiple retries:`, error);
        }
    }

    getTrackedSuppliesByUser(username) {
        const userTrackers = this.userTrackers.get(username);
        if (!userTrackers) return [];

        return Array.from(userTrackers.entries()).map(([trackerId, tracker]) => ({
            trackerId,
            tokenAddress: trackerId.split('_')[0],
            ticker: tracker.ticker,
            currentSupplyPercentage: tracker.currentSupplyPercentage.toFixed(2),
            trackType: tracker.trackType
        }));
    }

    async getTokenBalance(walletAddress, tokenAddress, mainContext, subContext) {
        return retryWithBackoff(async () => {
            try {
                if (!walletAddress || !tokenAddress) {
                    console.warn(`Invalid wallet address or token address: ${walletAddress}, ${tokenAddress}`);
                    return new BigNumber(0);
                }
    
                console.log(`Fetching token balance for wallet: ${walletAddress}, token: ${tokenAddress}`);
                
                const tokenAccounts = await solanaApi.getTokenAccountsByOwner(walletAddress, tokenAddress, mainContext, subContext);
                
                if (tokenAccounts && tokenAccounts.length > 0 && tokenAccounts[0].account?.data?.parsed?.info?.tokenAmount?.amount) {
                    const balance = new BigNumber(tokenAccounts[0].account.data.parsed.info.tokenAmount.amount);
                    console.log(`Balance for wallet ${walletAddress}: ${balance.toString()}`);
                    return balance;
                }
    
                console.warn(`No valid token account found for wallet ${walletAddress} and token ${tokenAddress}`);
                return new BigNumber(0);
            } catch (error) {
                console.error(`Error getting token balance for ${walletAddress}:`, error);
                throw error;
            }
        });
    }

    async getControlledSupply(controllingWallets, tokenAddress, totalSupply, decimals, mainContext, subContext) {
        if (!controllingWallets || controllingWallets.length === 0) {
            console.warn(`No controlling wallets found for ${tokenAddress}. Returning 0.`);
            return new BigNumber(0);
        }
    
        console.log(`Calculating controlled supply for token: ${tokenAddress}, Total supply: ${totalSupply.toString()}, Wallets:`, controllingWallets);
    
        // Modifiez cette ligne :
        const balances = await Promise.all(controllingWallets.map(wallet => this.getTokenBalance(wallet.address, tokenAddress, mainContext, subContext)));
        
        // Et mettez à jour le logging :
        balances.forEach((balance, index) => {
            console.log(`Wallet: ${controllingWallets[index].address}, Balance: ${balance.toString()}`);
        });
    
        const totalBalance = balances.reduce((total, balance) => total.plus(balance.dividedBy(new BigNumber(10).pow(decimals))), new BigNumber(0));
        const supplyPercentage = totalBalance.dividedBy(totalSupply).multipliedBy(100);
        console.log(`Total controlled balance: ${totalBalance.toString()}, Supply percentage: ${supplyPercentage.toFixed(2)}%`);
        return supplyPercentage;
    }
    
    async getTeamSupply(teamWallets, tokenAddress, totalSupply, decimals, mainContext, subContext) {
        if (!teamWallets || teamWallets.length === 0) {
            console.warn(`No team wallets found for ${tokenAddress}. Returning 0.`);
            return new BigNumber(0);
        }
    
        console.log(`Calculating team supply for token: ${tokenAddress}, Total supply: ${totalSupply.toString()}, Wallets:`, teamWallets);
    
        const balances = await Promise.all(teamWallets.map(wallet => this.getTokenBalance(wallet, tokenAddress, mainContext, subContext)));
        balances.forEach((balance, index) => {
            console.log(`Wallet: ${teamWallets[index]}, Balance: ${balance.toString()}`);
        });
    
        const totalBalance = balances.reduce((total, balance) => total.plus(balance.dividedBy(new BigNumber(10).pow(decimals))), new BigNumber(0));
        const supplyPercentage = totalBalance.dividedBy(totalSupply).multipliedBy(100);
        console.log(`Total team balance: ${totalBalance.toString()}, Supply percentage: ${supplyPercentage.toFixed(2)}%`);
        return supplyPercentage;
    }    

    async notifyChange(tracker, newPercentage, change) {
        const emoji = change.isGreaterThan(0) ? "📈" : "📉";
        const message = `⚠️ Significant change detected in ${tracker.trackType} supply for ${tracker.ticker}\n\n` +
                        `${tracker.trackType === 'team' ? 'Team' : 'Top holders'} now hold ${newPercentage.toFixed(2)}% (previously ${tracker.initialSupplyPercentage.toFixed(2)}%)\n\n` +
                        `${emoji} ${change.isGreaterThan(0) ? '+' : ''}${change.toFixed(2)}%`;
        
        await this.bot.sendMessage(tracker.chatId, message);
        console.log(`Notification sent for ${tracker.trackType} of ${tracker.ticker}: ${message}`);
    }
}

module.exports = SupplyTracker;