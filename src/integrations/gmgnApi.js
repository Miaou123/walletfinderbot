const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const UserAgent = require('user-agents');
const ApiCallCounter = require('../utils/ApiCallCounter');
const gmgnRateLimiter = require('../utils/rateLimiters/gmgnRateLimiter');
const logger = require('../utils/logger');

puppeteer.use(StealthPlugin());

class GmgnApi {
    constructor() {
        this.baseUrl = 'https://gmgn.ai/defi/quotation/v1';
        this.proxyUser = process.env.PROXY_USER;
        this.proxyPass = process.env.PROXY_PASS;
        this.proxyHost = process.env.PROXY_HOST || 'gate.smartproxy.com';
        this.proxyPort = process.env.PROXY_PORT || '10001'; // Use a static port

        // Initialize the browser instance here, so it can be reused
        this.browser = null;
    }

    // Initialize the browser only once
    async initializeBrowser() {
        if (!this.browser) {
            this.browser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-background-timer-throttling',
                    '--disable-renderer-backgrounding',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    `--proxy-server=${this.proxyHost}:${this.proxyPort}`, // Fixed proxy configuration
                ],
            });
        }
    }


    // Centralize page configuration: authentication, headers, request interception
    async configurePage(page) {
        // Proxy authentication
        await page.authenticate({
            username: this.proxyUser,
            password: this.proxyPass,
        });

        // Set User-Agent and custom headers
        const userAgent = new UserAgent();
        await page.setUserAgent(userAgent.toString());
        await page.setExtraHTTPHeaders({
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://gmgn.ai/',
            'Origin': 'https://gmgn.ai',
        });

        // Enable request interception to block unnecessary resources
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (['image', 'stylesheet', 'font'].includes(resourceType)) {
                req.abort();  // Block image, CSS, and font requests
            } else {
                req.continue(); // Continue for other request types (JSON, scripts, etc.)
            }
        });
    }

    // Fetch data using the existing browser
    async fetchData(url, method, mainContext = 'default', subContext = null) {
        ApiCallCounter.incrementCall('GMGN', method, mainContext, subContext);

        await this.initializeBrowser(); // Ensure the browser is initialized

        const requestFunction = async () => {
            const page = await this.browser.newPage(); // Reuse the same browser, but create a new page

            try {
                // Configure the page with authentication, headers, and request interception
                await this.configurePage(page);

                // Navigate to the target URL
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

                const data = await page.evaluate(() => {
                    const text = document.body.innerText;
                    console.log("Raw text:", text.substring(0, 100)); // Log les 100 premiers caractères
                    try {
                        return JSON.parse(text);
                    } catch (e) {
                        console.error("Parse error. Text starts with:", text.substring(0, 50));
                        throw e;
                    }
                });

                return data;
            } catch (error) {
                logger.error(`Error fetching data: ${error.message}`);
                throw error;
            } finally {
                await page.close(); // Close the page after the request is done
            }
        };

        return gmgnRateLimiter.enqueue(requestFunction);
    }

    async getTokenInfo(contractAddress, mainContext = 'default', subContext = null) {
        const url = `${this.baseUrl}/tokens/sol/${contractAddress}`;
        return this.fetchData(url, 'getTokenInfo', mainContext, subContext);
    }

    async getTeamTrades(contractAddress, mainContext = 'default', subContext = null) {
        const url = `${this.baseUrl}/trades/sol/${contractAddress}?limit=100&maker=&tag%5B%5D=creator&tag%5B%5D=dev_team`;
        return this.fetchData(url, 'getTeamTrades', mainContext, subContext);
    }

    async getTopTraders(contractAddress, mainContext = 'default', subContext = null) {
        const url = `${this.baseUrl}/tokens/top_traders/sol/${contractAddress}`;
        return this.fetchData(url, 'getTopTraders', mainContext, subContext);
    }

    async getAllTransactions(contractAddress, mainContext = 'default', subContext = null, cursor = null, limit = 100, revert = false) {
        let url = `${this.baseUrl}/trades/sol/${contractAddress}?limit=${limit}`;
        if (cursor) {
            url += `&cursor=${cursor}`;
        }
        if (revert) {
            url += '&revert=true';
        }
        return this.fetchData(url, 'getAllTransactions', mainContext, subContext);
    }

    async getWalletData(wallet, mainContext = 'default', subContext = null, period = '30d') {
        const validPeriods = ['3d', '7d', '30d'];
        
        if (!validPeriods.includes(period)) {
            throw new Error("Invalid period. Valid options are '3d', '7d', or '30d'.");
        }

        const url = `${this.baseUrl}/smartmoney/sol/walletNew/${wallet}?period=${period}`;
        return this.fetchData(url, 'getWalletData', mainContext, subContext);
    }

    async getNewPairs(limit = 50, mainContext = 'default', subContext = null) {
        if (limit > 50) {
            throw new Error("You cannot check more than 50 pairs.");
        }
        const url = `${this.baseUrl}/pairs/sol/new_pairs?limit=${limit}&orderby=open_timestamp&direction=desc&filters[]=not_honeypot`;
        return this.fetchData(url, 'getNewPairs', mainContext, subContext);
    }

    async getTrendingWallets(timeframe = '7d', walletTag = 'smart_degen', mainContext = 'default', subContext = null) {
        const validTimeframes = ['1d', '7d', '30d'];
        const validWalletTags = ['pump_smart', 'smart_degen', 'reowned', 'snipe_bot'];

        if (!validTimeframes.includes(timeframe)) {
            throw new Error("Invalid timeframe. Valid options are '1d', '7d', '30d'.");
        }

        if (!validWalletTags.includes(walletTag)) {
            throw new Error("Invalid wallet tag. Valid options are 'pump_smart', 'smart_degen', 'reowned', 'snipe_bot'.");
        }

        const url = `${this.baseUrl}/rank/sol/wallets/${timeframe}?tag=${walletTag}&orderby=pnl_${timeframe}&direction=desc`;
        return this.fetchData(url, 'getTrendingWallets', mainContext, subContext);
    }

    async getTrendingTokens(timeframe = '1h', mainContext = 'default', subContext = null) {
        const validTimeframes = ['1m', '5m', '1h', '6h', '24h'];
        if (!validTimeframes.includes(timeframe)) {
            throw new Error("Invalid timeframe. Valid options are '1m', '5m', '1h', '6h', '24h'.");
        }

        let url;
        if (timeframe === '1m') {
            url = `${this.baseUrl}/rank/sol/swaps/${timeframe}?orderby=swaps&direction=desc&limit=20`;
        } else {
            url = `${this.baseUrl}/rank/sol/swaps/${timeframe}?orderby=swaps&direction=desc`;
        }
        return this.fetchData(url, 'getTrendingTokens', mainContext, subContext);
    }

    async getTokensByCompletion(limit = 50, mainContext = 'default', subContext = null) {
        if (limit > 50) {
            throw new Error("Limit cannot be above 50.");
        }

        const url = `${this.baseUrl}/rank/sol/pump?limit=${limit}&orderby=progress&direction=desc&pump=true`;
        return this.fetchData(url, 'getTokensByCompletion', mainContext, subContext);
    }

    async findSnipedTokens(size = 10, mainContext = 'default', subContext = null) {
        if (size > 39) {
            throw new Error("Size cannot be more than 39.");
        }

        const url = `${this.baseUrl}/signals/sol/snipe_new?size=${size}&is_show_alert=false&featured=false`;
        return this.fetchData(url, 'findSnipedTokens', mainContext, subContext);
    }

    async getGasFee(mainContext = 'default', subContext = null) {
        const url = `${this.baseUrl}/chains/sol/gas_price`;
        return this.fetchData(url, 'getGasFee', mainContext, subContext);
    }

    async getTokenUsdPrice(contractAddress, mainContext = 'default', subContext = null) {
        if (!contractAddress) {
            throw new Error("You must input a contract address.");
        }

        const url = `${this.baseUrl}/sol/tokens/realtime_token_price?address=${contractAddress}`;
        return this.fetchData(url, 'getTokenUsdPrice', mainContext, subContext);
    }

    // Nouvelle méthode : getTopBuyers
    async getTopBuyers(contractAddress, mainContext = 'default', subContext = null) {
        if (!contractAddress) {
            throw new Error("You must input a contract address.");
        }

        const url = `${this.baseUrl}/tokens/top_buyers/sol/${contractAddress}`;
        return this.fetchData(url, 'getTopBuyers', mainContext, subContext);
    }

    // Nouvelle méthode : getSecurityInfo
    async getSecurityInfo(contractAddress, mainContext = 'default', subContext = null) {
        if (!contractAddress) {
            throw new Error("You must input a contract address.");
        }

        const url = `${this.baseUrl}/tokens/security/sol/${contractAddress}`;
        return this.fetchData(url, 'getSecurityInfo', mainContext, subContext);
    }

    // Nouvelle méthode : getWalletInfo
    async getWalletInfo(walletAddress, period = '7d', mainContext = 'default', subContext = null) {
        const validPeriods = ['7d', '30d'];

        if (!walletAddress) {
            throw new Error("You must input a wallet address.");
        }

        if (!validPeriods.includes(period)) {
            throw new Error("Invalid period. Valid options are '7d' or '30d'.");
        }

        const url = `${this.baseUrl}/smartmoney/sol/walletNew/${walletAddress}?period=${period}`;
        return this.fetchData(url, 'getWalletInfo', mainContext, subContext);
    }

    // Optionally, you can add a cleanup method to close the browser when it's no longer needed
    async closeBrowser() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }
}

module.exports = new GmgnApi();
