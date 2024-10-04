const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const UserAgent = require('user-agents');
const ApiCallCounter = require('../utils/ApiCallCounter');
const gmgnRateLimiter = require('../utils/rateLimiters/gmgnRateLimiter');

puppeteer.use(StealthPlugin());

class GmgnApi {
    constructor() {
      this.baseUrl = 'https://gmgn.ai/defi/quotation/v1';
    }
  
    async fetchData(url, method, mainContext = 'default', subContext = null) {
      ApiCallCounter.incrementCall('GMGN', method, mainContext, subContext);
  
      const requestFunction = async () => {
        const userAgent = new UserAgent();
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
  
        try {
          await page.setUserAgent(userAgent.toString());
          await page.setExtraHTTPHeaders({
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://gmgn.ai/',
            'Origin': 'https://gmgn.ai',
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
        }
      };
  
      // Utilisez le rate limiter avec retries
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

    async getAllTransactions(contractAddress, mainContext = 'default', subContext = null, cursor = null, limit = 1000) {
        let url = `${this.baseUrl}/trades/sol/${contractAddress}?limit=${limit}`;
        if (cursor) {
            url += `&cursor=${cursor}`;
        }
        return this.fetchData(url, 'getAllTransactions', mainContext, subContext);
    }

    async getWalletData(wallet, mainContext = 'default', subContext = null) {
        const url = `${this.baseUrl}/smartmoney/sol/walletNew/${wallet}`;
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
}

module.exports = new GmgnApi();
