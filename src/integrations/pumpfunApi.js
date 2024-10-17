const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const UserAgent = require('user-agents');
const ApiCallCounter = require('../utils/ApiCallCounter');
const pumpfunRateLimiter = require('../utils/rateLimiters/pumpfunRateLimiter');
const logger = require('../utils/logger');

puppeteer.use(StealthPlugin());

class PumpFunApi {
    constructor() {
        this.baseUrl = 'https://frontend-api.pump.fun';
        this.browser = null;
    }

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
                ],
            });
        }
    }

    async configurePage(page) {
        const userAgent = new UserAgent();
        await page.setUserAgent(userAgent.toString());
        await page.setExtraHTTPHeaders({
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://pump.fun/',
            'Origin': 'https://pump.fun',
        });

        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (['image', 'stylesheet', 'font'].includes(resourceType)) {
                req.abort();
            } else {
                req.continue();
            }
        });
    }

    async fetchData(url, method, mainContext = 'default', subContext = null) {
        ApiCallCounter.incrementCall('PumpFun', method, mainContext, subContext);

        await this.initializeBrowser();

        const requestFunction = async () => {
            const page = await this.browser.newPage();

            try {
                await this.configurePage(page);
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

                const pageContent = await page.content();
                const bodyText = await page.evaluate(() => document.body.innerText);

                try {
                    const data = JSON.parse(bodyText);
                    return data;
                } catch (parseError) {
                    logger.error(`JSON parsing error. Page content:`);
                    logger.error(pageContent);
                    logger.error(`Body text:`);
                    logger.error(bodyText);
                    throw new Error(`JSON parsing failed. Body text: ${bodyText}`);
                }
            } catch (error) {
                logger.error(`Error fetching data: ${error.message}`);
                throw error;
            } finally {
                await page.close();
            }
        };

        return pumpfunRateLimiter.enqueue(requestFunction);
    }

    async getAllTrades(address, limit = 200, offset = 0, minimumSize = 0, mainContext = 'default', subContext = null) {
        if (!address) {
            throw new Error("Vous devez fournir une adresse.");
        }

        const url = `${this.baseUrl}/trades/all/${address}?limit=${limit}&offset=${offset}&minimumSize=${minimumSize}`;
        return this.fetchData(url, 'getAllTrades', mainContext, subContext);
    }

    async closeBrowser() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }
}

module.exports = new PumpFunApi();