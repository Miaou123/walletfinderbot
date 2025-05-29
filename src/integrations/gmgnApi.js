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

    // All your existing API methods remain the same...
    async getTokenInfo(contractAddress, mainContext = 'default', subContext = null) {
        const url = `${this.baseUrl}/tokens/sol/${contractAddress}`;
        return this.fetchData(url, 'getTokenInfo', mainContext, subContext);
    }

    async getWalletData(wallet, mainContext = 'default', subContext = null, period = '30d') {
        const validPeriods = ['3d', '7d', '30d'];
        
        if (!validPeriods.includes(period)) {
            throw new Error("Invalid period. Valid options are '3d', '7d', or '30d'.");
        }

        const url = `${this.baseUrl}/smartmoney/sol/walletNew/${wallet}?period=${period}`;
        return this.fetchData(url, 'getWalletData', mainContext, subContext);
    }

    // Add all your other existing methods here...
    // They all follow the same pattern: this.fetchData(url, methodName, mainContext, subContext)

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