const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const ApiCallCounter = require('../utils/ApiCallCounter');
const pumpfunRateLimiter = require('../utils/rateLimiters/pumpfunRateLimiter');
const logger = require('../utils/logger');

puppeteer.use(StealthPlugin());

class PumpFunApi {
    constructor() {
        this.baseUrl = 'https://frontend-api-v3.pump.fun';
        this.browser = null;
        this.browserCreatedAt = null;
        this.requestCount = 0;
        
        // More reasonable limits
        this.maxBrowserAge = 30 * 60 * 1000; // 30 minutes
        this.maxRequestsPerBrowser = 50; // 50 requests per browser
        this.maxConcurrentPages = 3; // Limit concurrent pages
        
        // Initialization management
        this.initPromise = null;
        this.activePagesCount = 0;
    }

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

    async initializeBrowser() {
        // Prevent multiple concurrent initializations with Promise caching
        if (this.initPromise) {
            return this.initPromise;
        }

        if (!this.shouldRestartBrowser()) {
            return this.browser;
        }

        this.initPromise = this._doInitializeBrowser();
        
        try {
            await this.initPromise;
            return this.browser;
        } finally {
            this.initPromise = null;
        }
    }

    async _doInitializeBrowser() {
        try {
            // Close existing browser cleanly
            if (this.browser) {
                try {
                    await this.browser.close();
                    logger.debug('Previous PumpFun browser closed');
                } catch (error) {
                    logger.warn('Error closing previous browser:', error.message);
                }
            }

            logger.debug('Launching new PumpFun browser...');
            
            // Minimal, stable Chrome configuration for VM
            this.browser = await puppeteer.launch({
                headless: true,
                args: [
                    // Essential VM flags only
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    
                    // Performance optimizations
                    '--disable-gpu',
                    '--disable-extensions',
                    '--disable-default-apps',
                    '--no-first-run',
                    
                    // Memory management
                    '--memory-pressure-off',
                    '--max_old_space_size=512',
                    
                    // Stability
                    '--disable-background-timer-throttling',
                    '--disable-renderer-backgrounding',
                    '--disable-backgrounding-occluded-windows'
                ],
                timeout: 30000,
                ignoreDefaultArgs: ['--enable-automation']
            });

            // Quick browser health check
            const testPage = await this.browser.newPage();
            await testPage.goto('data:text/html,<h1>Test</h1>', { timeout: 5000 });
            await testPage.close();
            
            this.browserCreatedAt = Date.now();
            this.requestCount = 0;
            this.activePagesCount = 0;
            
            // Set up disconnect handler
            this.browser.on('disconnected', () => {
                logger.warn('PumpFun browser disconnected unexpectedly');
                this.browser = null;
                this.browserCreatedAt = null;
                this.initPromise = null;
            });

            logger.info('PumpFun browser launched successfully');
            
        } catch (error) {
            logger.error('Failed to launch PumpFun browser:', error);
            this.browser = null;
            this.browserCreatedAt = null;
            throw error;
        }
    }

    async configurePage(page) {
        try {
            // Set reasonable timeouts
            page.setDefaultTimeout(15000);
            page.setDefaultNavigationTimeout(20000);

            // Consistent user agent
            await page.setUserAgent(
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            );
            
            // Essential headers for PumpFun
            await page.setExtraHTTPHeaders({
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache',
                'Referer': 'https://pump.fun/',
                'Origin': 'https://pump.fun'
            });

            // Lightweight resource blocking
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                const resourceType = req.resourceType();
                const url = req.url();
                
                // Block only heavy, non-essential resources
                if (['image', 'media', 'font'].includes(resourceType) ||
                    url.includes('analytics') || 
                    url.includes('tracking')) {
                    req.abort();
                } else {
                    req.continue();
                }
            });

            // Set realistic viewport
            await page.setViewport({ width: 1366, height: 768 });
            
        } catch (error) {
            logger.error('Error configuring PumpFun page:', error);
            throw error;
        }
    }

    async fetchData(url, method, mainContext = 'default', subContext = null) {
        ApiCallCounter.incrementCall('PumpFun', method, mainContext, subContext);
        
        const requestFunction = async () => {
            // Limit concurrent pages to prevent resource exhaustion
            while (this.activePagesCount >= this.maxConcurrentPages) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            const maxRetries = 2;
            let lastError;
            
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                let page = null;
                
                try {
                    logger.debug(`PumpFun ${method} - Attempt ${attempt}/${maxRetries}`);
                    
                    // Ensure browser is ready
                    await this.initializeBrowser();
                    
                    if (!this.browser?.connected) {
                        throw new Error('Browser not available');
                    }

                    // Create and track page
                    this.activePagesCount++;
                    page = await this.browser.newPage();
                    this.requestCount++;
                    
                    await this.configurePage(page);
                    
                    // Navigate with logging
                    logger.debug(`Navigating to: ${url}`);
                    await page.goto(url, { 
                        waitUntil: 'domcontentloaded', 
                        timeout: 15000 
                    });
                    
                    // Brief wait for dynamic content
                    await new Promise(resolve => setTimeout(resolve, 300));
                    
                    // Extract and parse data
                    const data = await page.evaluate(() => {
                        const text = document.body.innerText;
                        
                        if (!text || text.trim().length === 0) {
                            throw new Error('Empty page content');
                        }
                        
                        try {
                            return JSON.parse(text);
                        } catch (e) {
                            throw new Error(`JSON parsing failed. Content: ${text.substring(0, 200)}`);
                        }
                    });

                    logger.debug(`PumpFun ${method} successful on attempt ${attempt}`);
                    return data;
                    
                } catch (error) {
                    lastError = error;
                    logger.warn(`PumpFun ${method} attempt ${attempt}/${maxRetries} failed: ${error.message}`);
                    
                    // Check for browser-breaking errors
                    const isBrowserError = error.message.includes('Protocol error') || 
                                         error.message.includes('Connection closed') ||
                                         error.message.includes('Target closed') ||
                                         error.message.includes('detached Frame');
                    
                    if (isBrowserError) {
                        logger.warn('Browser error detected, forcing restart');
                        this._forceBrowserRestart();
                    }
                    
                    // Wait before retry (except on last attempt)
                    if (attempt < maxRetries) {
                        const delay = 1000 * attempt;
                        logger.debug(`Waiting ${delay}ms before retry...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                    
                } finally {
                    // Always clean up page and decrement counter
                    if (page) {
                        try {
                            await page.close();
                        } catch (closeError) {
                            logger.debug('Error closing page:', closeError.message);
                        }
                        this.activePagesCount = Math.max(0, this.activePagesCount - 1);
                    }
                }
            }
            
            throw lastError || new Error(`PumpFun ${method} failed after ${maxRetries} attempts`);
        };

        return pumpfunRateLimiter.enqueue(requestFunction);
    }

    _forceBrowserRestart() {
        if (this.browser) {
            this.browser.close().catch(() => {}); // Don't wait, just try to close
        }
        this.browser = null;
        this.browserCreatedAt = null;
        this.requestCount = 0;
        this.activePagesCount = 0;
        this.initPromise = null;
    }

    // API Methods (unchanged)
    async getUserInfo(address, mainContext = 'default', subContext = null) {
        const url = `${this.baseUrl}/users/${address}`;
        return this.fetchData(url, 'getUserInfo', mainContext, subContext);
    }

    async getBalances(address, mainContext = 'default', subContext = null) {
        const url = `${this.baseUrl}/balances/${address}?limit=50&offset=0&minBalance=-1`;
        return this.fetchData(url, 'getBalances', mainContext, subContext);
    }

    async getFollowers(address, mainContext = 'default', subContext = null) {
        const url = `${this.baseUrl}/following/followers/${address}`;
        return this.fetchData(url, 'getFollowers', mainContext, subContext);
    }

    async getFollowing(address, mainContext = 'default', subContext = null) {
        const url = `${this.baseUrl}/following/${address}`;
        return this.fetchData(url, 'getFollowing', mainContext, subContext);
    }

    async getCreatedCoins(address, limit = 10, offset = 0, mainContext = 'default', subContext = null) {
        if (!address) {
            throw new Error("Address is required");
        }
    
        const url = `${this.baseUrl}/coins/user-created-coins/${address}?offset=${offset}&limit=${limit}&includeNsfw=false`;
        return this.fetchData(url, 'getCreatedCoins', mainContext, subContext);
    }

    async getAllTrades(address, limit = 200, offset = 0, minimumSize = 0, mainContext = 'default', subContext = null) {
        if (!address) {
            throw new Error("Address is required");
        }
        
        const url = `${this.baseUrl}/trades/all/${address}?limit=${limit}&offset=${offset}&minimumSize=${minimumSize}`;
        return this.fetchData(url, 'getAllTrades', mainContext, subContext);
    }

    async closeBrowser() {
        if (this.browser) {
            try {
                await this.browser.close();
                logger.debug('PumpFun browser closed');
            } catch (error) {
                logger.warn('Error closing browser:', error.message);
            }
            this.browser = null;
            this.browserCreatedAt = null;
            this.requestCount = 0;
            this.activePagesCount = 0;
        }
    }

    // Health monitoring
    isHealthy() {
        return this.browser && this.browser.connected && this.activePagesCount < this.maxConcurrentPages;
    }

    getStats() {
        const now = Date.now();
        const browserAge = this.browserCreatedAt ? Math.round((now - this.browserCreatedAt) / 1000 / 60) : 0;
        
        return {
            browserConnected: this.browser?.connected || false,
            browserAge: browserAge, // minutes
            requestCount: this.requestCount,
            activePagesCount: this.activePagesCount,
            needsRestart: this.shouldRestartBrowser()
        };
    }
}

module.exports = new PumpFunApi();
