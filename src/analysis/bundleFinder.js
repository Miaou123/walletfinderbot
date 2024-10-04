const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const UserAgent = require('user-agents');

class BundleFinder {
    constructor() {
        this.txHashes = new Set();
        this.formatTokens = (x) => parseFloat(x) / 1_000_000;
    }

    async fetchData(url) {
        const userAgent = new UserAgent();
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        
        try {
            await page.setUserAgent(userAgent.toString());
            await page.goto(url, { waitUntil: 'networkidle0' });
            
            const data = await page.evaluate(() => {
                const text = document.body.innerText;
                return JSON.parse(text);
            });

            await browser.close();
            return data;
        } catch (error) {
            console.error(`Error fetching data: ${error.message}`);
            await browser.close();
            throw error;
        }
    }

    async teamTrades(contractAddress) {
        try {
            const tokenInfo = await gmgnApi.getTokenInfo(contractAddress);
            const info = tokenInfo.data.token;
            const totalSupply = info.launchpad.toLowerCase() === "pump.fun" ? 1_000_000_000 : info.total_supply;

            const tradesData = await gmgnApi.getTeamTrades(contractAddress);
            const response = tradesData.data.history;

            for (const buy of response) {
                if (buy.event === "buy") {
                    this.txHashes.add(buy.tx_hash);
                }
            }

            return [this.txHashes, totalSupply];
        } catch (error) {
            console.error(`Error in teamTrades: ${error.message}`);
            throw error;
        }
    }

    async checkBundle(txHashes, totalSupply) {
        let total_amount = 0.00;
        let transactions = 0;

        const data = {
            transactions: 0,
            totalAmount: 0.00,
            bundleDetected: false,
            transactionDetails: {}
        };

        for (const txHash of txHashes) {
            const url = `https://api.solana.fm/v0/transfers/${txHash}`;
            try {
                const response = await this.fetchData(url);
                const actions = response.result.data;

                if (Array.isArray(actions)) {
                    for (const action of actions) {
                        if (action.action === "transfer" && action.token !== "") {
                            const amount = this.formatTokens(action.amount);
                            total_amount += amount;
                            transactions += 1;
                        }
                    }
                }

                const amounts = actions
                    .filter(action => action.action === "transfer" && action.token !== "")
                    .map(action => this.formatTokens(action.amount));

                if (amounts.length > 0) {
                    const amountsPercentages = amounts.map(amount => (amount / totalSupply) * 100);
                    data.transactionDetails[txHash] = {
                        amounts,
                        amountsPercentages
                    };
                }
            } catch (error) {
                console.error(`Error fetching transaction data for ${txHash}: ${error.message}`);
            }
        }

        data.transactions = transactions;
        data.totalAmount = total_amount;
        data.bundleDetected = transactions > 1;

        data.developerInfo = {
            bundledAmount: total_amount,
            percentageOfSupply: total_amount / totalSupply
        };

        return data;
    }

    async findBundle(contractAddress) {
        try {
            const [txHashes, totalSupply] = await this.teamTrades(contractAddress);
            const bundleData = await this.checkBundle(txHashes, totalSupply);
            return bundleData;
        } catch (error) {
            console.error(`Error in findBundle: ${error.message}`);
            throw error;
        }
    }
}

module.exports = BundleFinder;