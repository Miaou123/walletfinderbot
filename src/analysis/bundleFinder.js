const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const UserAgent = require('user-agents');
const gmgnApi = require('../integrations/gmgnApi'); // Assurez-vous que ce chemin est correct

puppeteer.use(StealthPlugin());

class BundleFinder {
    constructor() {
        this.txHashes = new Set();
    }

    async fetchData(url) {
        const userAgent = new UserAgent();
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        
        try {
            await page.setUserAgent(userAgent.toString());
            await page.goto(url, { waitUntil: 'networkidle0' });
            
            const data = await page.evaluate(() => {
                return JSON.parse(document.body.innerText);
            });

            return data;
        } catch (error) {
            console.error(`Error fetching data: ${error.message}`);
            throw error;
        } finally {
            await browser.close();
        }
    }

    async teamTrades(contractAddress) {
        try {
            const tokenInfo = await gmgnApi.getTokenInfo(contractAddress);
            const info = tokenInfo.data.token;
            const totalSupply = info.launchpad.toLowerCase() === "pump.fun" ? 1_000_000_000 : info.total_supply;

            const tradesData = await gmgnApi.getTeamTrades(contractAddress);
            const buyTrades = tradesData.data.history.filter(trade => trade.event === "buy");
            
            this.txHashes = new Set(buyTrades.map(trade => trade.tx_hash));

            return [this.txHashes, totalSupply];
        } catch (error) {
            console.error(`Error in teamTrades: ${error.message}`);
            throw error;
        }
    }

    async checkBundle(txHashes, totalSupply) {
        const data = {
            transactions: 0,
            totalAmount: 0,
            bundleDetected: false,
            transactionDetails: {},
            developerInfo: {}
        };

        for (const txHash of txHashes) {
            try {
                const response = await this.fetchData(`https://api.solana.fm/v0/transfers/${txHash}`);
                const actions = response.result.data;

                if (Array.isArray(actions)) {
                    const transferActions = actions.filter(action => action.action === "transfer" && action.token !== "");
                    const amounts = transferActions.map(action => this.formatTokens(action.amount));
                    
                    data.transactions += transferActions.length;
                    data.totalAmount += amounts.reduce((sum, amount) => sum + amount, 0);

                    if (amounts.length > 0) {
                        data.transactionDetails[txHash] = {
                            amounts,
                            amountsPercentages: amounts.map(amount => (amount / totalSupply) * 100)
                        };
                    }
                }
            } catch (error) {
                console.error(`Error fetching transaction data for ${txHash}: ${error.message}`);
            }
        }

        data.bundleDetected = data.transactions > 1;
        data.developerInfo = {
            bundledAmount: data.totalAmount,
            percentageOfSupply: data.totalAmount / totalSupply
        };

        return data;
    }

    async findBundle(contractAddress) {
        try {
            const [txHashes, totalSupply] = await this.teamTrades(contractAddress);
            return await this.checkBundle(txHashes, totalSupply);
        } catch (error) {
            console.error(`Error in findBundle: ${error.message}`);
            throw error;
        }
    }

    formatTokens(x) {
        return parseFloat(x) / 1_000_000;
    }
}

module.exports = BundleFinder;