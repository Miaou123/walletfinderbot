const { rateLimitedAxios } = require('../utils/rateLimiter');
const BigNumber = require('bignumber.js');
const config = require('../utils/config');
const { getSolanaApi } = require('../integrations/solanaApi');

const solanaApi = getSolanaApi();

const CHECK_INTERVAL = 1 * 60 * 1000; // 5 minutes

// Utility function for exponential backoff
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
    constructor(bot) {
        this.trackers = new Map();
        this.bot = bot;
    }

    startTracking(tokenAddress, chatId, wallets, initialSupplyPercentage, totalSupply, significantChangeThreshold, ticker, decimals, trackType) {
        console.log(`Starting tracking with parameters:`, {
            tokenAddress,
            chatId,
            wallets,
            initialSupplyPercentage,
            totalSupply,
            significantChangeThreshold,
            ticker,
            decimals,
            trackType
        });
    
        if (!this.trackers.has(tokenAddress)) {
            this.trackers.set(tokenAddress, new Map());
        }
    
        const tokenTrackers = this.trackers.get(tokenAddress);
        const trackerId = `${trackType}_${chatId}`;
        
        if (!wallets || !Array.isArray(wallets) || wallets.length === 0) {
            console.warn(`No wallets provided for ${trackType} tracking of ${tokenAddress}. This may cause issues.`);
        }
    
        const tracker = {
            chatId,
            wallets: wallets || [],
            initialSupplyPercentage: new BigNumber(initialSupplyPercentage),
            currentSupplyPercentage: new BigNumber(initialSupplyPercentage),
            totalSupply: new BigNumber(totalSupply),
            significantChangeThreshold: new BigNumber(significantChangeThreshold),
            ticker,
            decimals,
            trackType,
            intervalId: setInterval(() => this.checkSupply(tokenAddress, trackerId), CHECK_INTERVAL)
        };
    
        tokenTrackers.set(trackerId, tracker);
        console.log(`Started ${trackType} tracking for ${tokenAddress}. Initial supply: ${initialSupplyPercentage}%, Threshold: ${significantChangeThreshold}%, Wallets count: ${tracker.wallets.length}`);
    }
    


    stopTracking(tokenAddress) {
        const tracker = this.trackers.get(tokenAddress);
        if (tracker) {
            clearInterval(tracker.intervalId);
            this.trackers.delete(tokenAddress);
            console.log(`Stopped tracking for ${tokenAddress}`);
        }
    }

    async checkSupply(tokenAddress, trackerId) {
        const tokenTrackers = this.trackers.get(tokenAddress);
        if (!tokenTrackers) {
            console.warn(`No trackers found for token ${tokenAddress}`);
            return;
        }
        
        const tracker = tokenTrackers.get(trackerId);
        if (!tracker) {
            console.warn(`No tracker found for ID ${trackerId} of token ${tokenAddress}`);
            return;
        }
    
        try {
            await retryWithBackoff(async () => {
                let newSupplyPercentage;
                if (tracker.trackType === 'team') {
                    newSupplyPercentage = await this.getTeamSupply(tracker.wallets, tokenAddress, tracker.totalSupply, tracker.decimals);
                } else {
                    newSupplyPercentage = await this.getControlledSupply(tracker.wallets, tokenAddress, tracker.totalSupply, tracker.decimals);
                }            
    
                if (newSupplyPercentage.isNaN()) {
                    throw new Error(`Invalid supply percentage calculated for ${tokenAddress} (${tracker.trackType})`);
                }
    
                const change = newSupplyPercentage.minus(tracker.initialSupplyPercentage);
    
                console.log(`Check for ${tokenAddress} (${tracker.trackType}): Current supply: ${newSupplyPercentage.toFixed(2)}%, Initial: ${tracker.initialSupplyPercentage.toFixed(2)}%, Change: ${change.toFixed(2)}%`);
    
                if (change.abs().isGreaterThanOrEqualTo(tracker.significantChangeThreshold)) {
                    await this.notifyChange(tracker, newSupplyPercentage, change);
                    tracker.initialSupplyPercentage = newSupplyPercentage;
                    console.log(`Significant change detected for ${tracker.trackType}. New initial supply set to: ${newSupplyPercentage.toFixed(2)}%`);
                }
    
                tracker.currentSupplyPercentage = newSupplyPercentage;
            });
        } catch (error) {
            console.error(`Error checking ${tracker.trackType} supply for ${tokenAddress} after multiple retries:`, error);
        }
    }

    async getTokenBalance(walletAddress, tokenAddress, mainContext, subContext) {
        return retryWithBackoff(async () => {
            try {
                if (!walletAddress || !tokenAddress) {
                    console.warn(`Invalid wallet address or token address: ${walletAddress}, ${tokenAddress}`);
                    return new BigNumber(0);
                }
    
                console.log(`Fetching token balance for wallet: ${walletAddress}, token: ${tokenAddress}`);
                
                const tokenAccounts = await solanaApi.getTokenAccountsByOwner(walletAddress, { mint: tokenAddress }, { encoding: 'jsonParsed' }, mainContext, subContext);
                
                if (tokenAccounts && tokenAccounts.length > 0 && tokenAccounts[0].account?.data?.parsed?.info?.tokenAmount?.amount) {
                    const balance = new BigNumber(tokenAccounts[0].account.data.parsed.info.tokenAmount.amount);
                    console.log(`Balance for wallet ${walletAddress}: ${balance.toString()}`);
                    return balance;
                }
    
                console.warn(`No valid token account found for wallet ${walletAddress} and token ${tokenAddress}`);
                return new BigNumber(0);
            } catch (error) {
                console.error(`Error getting token balance for ${walletAddress}:`, error);
                throw error; // Re-throw the error to trigger retry
            }
        });
    }

    async getControlledSupply(controllingWallets, tokenAddress, totalSupply, decimals, mainContext, subContext) {
        if (!controllingWallets || controllingWallets.length === 0) {
            console.warn(`No controlling wallets found for ${tokenAddress}. Returning 0.`);
            return new BigNumber(0);
        }
    
        console.log(`Calculating controlled supply for token: ${tokenAddress}, Total supply: ${totalSupply.toString()}, Wallets:`, controllingWallets);
    
        const balances = await Promise.all(controllingWallets.map(wallet => this.getTokenBalance(wallet.address, tokenAddress, mainContext, subContext)));
        
        balances.forEach((balance, index) => {
            console.log(`Wallet: ${controllingWallets[index].address}, Balance: ${balance.toString()}`);
        });
    
        // Convert token balances using the decimals
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
    
        // Convert token balances using the decimals
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