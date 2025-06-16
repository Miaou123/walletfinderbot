/**
 * gmgnApiTester.js - Standalone script to test gmgnApi.getWalletData
 * 
 * Usage: 
 * 1. Replace 'YOUR_WALLET_ADDRESS' with the wallet address you want to test
 * 2. Run with: node gmgnApiTester.js
 */

// Import required modules
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const UserAgent = require('user-agents');
const Bottleneck = require('bottleneck');
require('dotenv').config();

// Initialize stealth mode for puppeteer
puppeteer.use(StealthPlugin());

// Create a rate limiter
const gmgnRateLimiter = new Bottleneck({
  reservoir: 20,            // 20 requests allowed
  reservoirRefreshAmount: 20, // Replenish 20 permits
  reservoirRefreshInterval: 1000, // Every 1 second
  maxConcurrent: 5,        // Only 5 requests in parallel
  minTime: 50            // Minimum 50ms between requests
});

class GmgnApiTester {
  constructor() {
    this.baseUrl = 'https://gmgn.ai/defi/quotation/v1';
    this.proxyUser = process.env.PROXY_USER;
    this.proxyPass = process.env.PROXY_PASS;
    this.proxyHost = process.env.PROXY_HOST || 'gate.smartproxy.com';
    this.proxyPort = process.env.PROXY_PORT || '10001';

    // Browser instance
    this.browser = null;
  }

  async initializeBrowser() {
    if (!this.browser) {
      console.log('Initializing browser...');
      const args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ];
      
      // Add proxy if configured
      if (this.proxyUser && this.proxyPass) {
        console.log(`Using proxy: ${this.proxyHost}:${this.proxyPort}`);
        args.push(`--proxy-server=${this.proxyHost}:${this.proxyPort}`);
      }
      
      this.browser = await puppeteer.launch({
        headless: true,
        args
      });
    }
  }

  async configurePage(page) {
    console.log('Configuring page...');
    
    // Set proxy authentication if needed
    if (this.proxyUser && this.proxyPass) {
      await page.authenticate({
        username: this.proxyUser,
        password: this.proxyPass,
      });
    }

    // Set user agent and headers
    const userAgent = new UserAgent();
    await page.setUserAgent(userAgent.toString());
    await page.setExtraHTTPHeaders({
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://gmgn.ai/',
      'Origin': 'https://gmgn.ai',
    });

    // Block unnecessary resources
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

  async fetchData(url) {
    console.log(`Fetching data from: ${url}`);
    await this.initializeBrowser();

    const requestFunction = async () => {
      const page = await this.browser.newPage();

      try {
        await this.configurePage(page);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Log the page content for debugging
        const pageContent = await page.content();
        console.log('Page content length:', pageContent.length);
        
        const data = await page.evaluate(() => {
          const text = document.body.innerText;
          try {
            return JSON.parse(text);
          } catch (e) {
            console.error("Parse error. Text starts with:", text.substring(0, 100));
            throw e;
          }
        });

        return data;
      } catch (error) {
        console.error(`Error fetching data: ${error.message}`);
        throw error;
      } finally {
        await page.close();
      }
    };

    return gmgnRateLimiter.schedule(() => requestFunction());
  }

  async getWalletData(walletAddress, period = '30d') {
    const validPeriods = ['3d', '7d', '30d'];
    
    if (!validPeriods.includes(period)) {
      throw new Error("Invalid period. Valid options are '3d', '7d', or '30d'.");
    }

    const url = `${this.baseUrl}/smartmoney/sol/walletNew/${walletAddress}?period=${period}`;
    return this.fetchData(url);
  }

  async close() {
    if (this.browser) {
      console.log('Closing browser...');
      await this.browser.close();
      this.browser = null;
    }
  }
}

// Main function
async function main() {
  // ===== CHANGE THIS VALUE =====
  const walletAddress = '9mqARJAKtFjZMvhwcy1mNeSj9iRvKiC6R9bGtsys1oF'; 
  // =============================
  
  if (walletAddress === 'YOUR_WALLET_ADDRESS') {
    console.error('Please replace YOUR_WALLET_ADDRESS with an actual wallet address!');
    process.exit(1);
  }

  const tester = new GmgnApiTester();
  
  try {
    console.log(`Testing getWalletData for address: ${walletAddress}`);
    
    // Test with default period (30d)
    console.log('\n--- Testing with default period (30d) ---');
    const data30d = await tester.getWalletData(walletAddress);
    console.log('\nAPI Response:');
    console.log(JSON.stringify(data30d, null, 2));
    
    // Test with 7d period
    console.log('\n--- Testing with 7d period ---');
    const data7d = await tester.getWalletData(walletAddress, '7d');
    
    // Extract and display relevant wallet data
    if (data7d.code === 0 && data7d.data) {
      console.log('\nWallet Summary (7d):');
      const walletData = data7d.data;
      console.log(`Sol Balance: ${walletData.sol_balance || 'N/A'}`);
      console.log(`Total Value: $${walletData.total_value || 'N/A'}`);
      console.log(`Win Rate: ${(walletData.winrate || 0) * 100}%`);
      console.log(`PnL (7d): $${walletData.realized_profit_7d || 'N/A'}`);
      console.log(`Unrealized Profit: $${walletData.unrealized_profit || 'N/A'}`);
    }
    
  } catch (error) {
    console.error('Error running test:', error);
  } finally {
    await tester.close();
  }
}

// Run the main function
main().catch(console.error);