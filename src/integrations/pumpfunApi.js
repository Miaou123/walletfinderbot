const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const UserAgent = require('user-agents');
const ApiCallCounter = require('../utils/ApiCallCounter');
const pumpfunRateLimiter = require('../utils/rateLimiters/pumpfunRateLimiter');

puppeteer.use(StealthPlugin());

class PumpFunApi {
    constructor() {
        this.baseUrl = 'https://frontend-api.pump.fun';
    }

    async fetchData(url, method, mainContext = 'default', subContext = null) {
        ApiCallCounter.incrementCall('PumpFun', method, mainContext, subContext);

        const requestFunction = async () => {
            const userAgent = new UserAgent();
            const browser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu'
                ]
            });
            const page = await browser.newPage();

            try {
                await page.setUserAgent(userAgent.toString());
                await page.setExtraHTTPHeaders({
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Referer': 'https://pump.fun/',
                    'Origin': 'https://pump.fun',
                });
                await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

                const data = await page.evaluate(() => {
                    const text = document.body.innerText;
                    return JSON.parse(text);
                });

                await browser.close();
                return data;
            } catch (error) {
                await browser.close();
                throw error;
            } finally {
                await browser.close();
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

}

module.exports = new PumpFunApi();
