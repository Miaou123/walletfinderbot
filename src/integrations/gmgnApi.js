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
        this.proxyPort = process.env.PROXY_PORT || '10001';

        // Browser management
        this.browser = null;
        this.browserCreatedAt = null;
        this.maxBrowserAge = 15 * 60 * 1000; // 15 minutes max browser age
        this.requestCount = 0;
        this.maxRequestsPerBrowser = 20; // Restart browser every 20 requests
        this.isInitializing = false;
    }

    // Check if browser needs to be restarted
    shouldRestartBrowser() {
        if (!this.browser) return true;
        
        const now = Date.now();
        const browserAge = this.browserCreatedAt ? now - this.browserCreatedAt : 0;
        
        return (
            !this.browser.connected ||
            browserAge > this.maxBrowserAge ||
            this.requestCount >= this.maxRequestsPerBrowser
        );
    }

    // Initialize browser with better error handling
    async initializeBrowser() {
        // Prevent multiple concurrent initializations
        if (this.isInitializing) {
            logger.debug('Browser initialization already in progress, waiting...');
            // Wait for ongoing initialization
            while (this.isInitializing) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            return this.browser;
        }

        if (!this.shouldRestartBrowser()) {
            return this.browser;
        }

        this.isInitializing = true;

        try {
            // Close existing browser if it exists
            if (this.browser) {
                try {
                    await this.browser.close();
                    logger.debug('Old browser closed');
                } catch (error) {
                    logger.warn('Error closing old browser:', error.message);
                }
            }

            logger.debug('Launching new browser...');
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
                    '--memory-pressure-off',
                    '--disable-background-networking',
                    '--disable-features=TranslateUI',
                    `--proxy-server=${this.proxyHost}:${this.proxyPort}`,
                ],
                timeout: 30000,
            });

            this.browserCreatedAt = Date.now();
            this.requestCount = 0;

            // Set up event listeners
            this.browser.on('disconnected', () => {
                logger.warn('Browser disconnected, marking for restart');
                this.browser = null;
                this.browserCreatedAt = null;
            });

            logger.debug('New browser launched successfully');
            return this.browser;

        } catch (error) {
            logger.error('Failed to initialize browser:', error);
            this.browser = null;
            this.browserCreatedAt = null;
            throw error;
        } finally {
            this.isInitializing = false;
        }
    }

    // Enhanced page configuration
    async configurePage(page) {
        try {
            // Set timeouts
            page.setDefaultTimeout(30000);
            page.setDefaultNavigationTimeout(30000);
            
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
                'Connection': 'keep-alive',
            });

            // Enable request interception to block unnecessary resources
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                const resourceType = req.resourceType();
                if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                    req.abort();
                } else {
                    req.continue();
                }
            });

            // Set a reasonable viewport
            await page.setViewport({ width: 1280, height: 720 });

        } catch (error) {
            logger.error('Error configuring page:', error);
            throw error;
        }
    }

    // Robust fetch data with retry logic
    async fetchData(url, method, mainContext = 'default', subContext = null) {
        ApiCallCounter.incrementCall('GMGN', method, mainContext, subContext);

        const requestFunction = async () => {
            const maxRetries = 3;
            let lastError;

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                let page = null;
                
                try {
                    // Ensure browser is ready
                    await this.initializeBrowser();
                    
                    if (!this.browser || !this.browser.connected) {
                        throw new Error('Browser not available');
                    }

                    // Create new page
                    page = await this.browser.newPage();
                    this.requestCount++;
                    
                    logger.debug(`Request ${this.requestCount} - Attempt ${attempt}/${maxRetries} for ${method}`);
                    
                    // Configure the page
                    await this.configurePage(page);

                    // Navigate with retry-friendly timeout
                    await page.goto(url, { 
                        waitUntil: 'domcontentloaded', 
                        timeout: 25000 
                    });

                    // Extract data
                    const data = await page.evaluate(() => {
                        const text = document.body.innerText;
                        try {
                            return JSON.parse(text);
                        } catch (e) {
                            throw new Error(`JSON parsing failed. Content: ${text.substring(0, 200)}`);
                        }
                    });

                    logger.debug(`Successfully fetched data for ${method} on attempt ${attempt}`);
                    return data;

                } catch (error) {
                    lastError = error;
                    logger.warn(`Attempt ${attempt}/${maxRetries} failed for ${method}:`, error.message);
                    
                    // If it's a connection/protocol error, force browser restart
                    if (error.message.includes('Protocol error') || 
                        error.message.includes('Connection closed') ||
                        error.message.includes('Target closed')) {
                        
                        logger.warn('Connection error detected, forcing browser restart');
                        this.browser = null;
                        this.browserCreatedAt = null;
                    }
                    
                    // Don't retry immediately on the last attempt
                    if (attempt < maxRetries) {
                        const delay = Math.min(1000 * attempt, 5000);
                        logger.debug(`Waiting ${delay}ms before retry...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                    
                } finally {
                    // Always close the page
                    if (page) {
                        try {
                            await page.close();
                        } catch (closeError) {
                            logger.debug('Error closing page:', closeError.message);
                        }
                    }
                }
            }

            // If all retries failed, throw the last error
            logger.error(`All ${maxRetries} attempts failed for ${method}:`, lastError.message);
            throw lastError;
        };

        return gmgnRateLimiter.enqueue(requestFunction);
    }

    // ===== ALL API METHODS FROM YOUR ORIGINAL FILE =====

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

    async getTopBuyers(contractAddress, mainContext = 'default', subContext = null) {
        if (!contractAddress) {
            throw new Error("You must input a contract address.");
        }

        const url = `${this.baseUrl}/tokens/top_buyers/sol/${contractAddress}`;
        return this.fetchData(url, 'getTopBuyers', mainContext, subContext);
    }

    async getSecurityInfo(contractAddress, mainContext = 'default', subContext = null) {
        if (!contractAddress) {
            throw new Error("You must input a contract address.");
        }

        const url = `${this.baseUrl}/tokens/security/sol/${contractAddress}`;
        return this.fetchData(url, 'getSecurityInfo', mainContext, subContext);
    }

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

    // Cleanup method
    async closeBrowser() {
        if (this.browser) {
            try {
                await this.browser.close();
                logger.info('Browser closed gracefully');
            } catch (error) {
                logger.warn('Error closing browser:', error.message);
            } finally {
                this.browser = null;
                this.browserCreatedAt = null;
                this.requestCount = 0;
            }
        }
    }
}

module.exports = new GmgnApi();
