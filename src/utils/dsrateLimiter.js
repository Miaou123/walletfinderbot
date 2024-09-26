const axios = require('axios');
const { default: PQueue } = require('p-queue');

class DexScreenerRateLimiter {
  constructor(maxRequestsPerMinute = 300) {
    this.queue = new PQueue({ concurrency: 1 });
    this.maxRequestsPerMinute = maxRequestsPerMinute;
    this.requestsThisMinute = 0;
    this.resetTime = Date.now() + 60000; // 1 minute from now
  }

  async makeRequest(config) {
    return this.queue.add(() => this.processRequest(config));
  }

  async processRequest(config) {
    await this.waitForAvailableSlot();
    
    try {
      const response = await axios(config);
      return response;
    } catch (error) {
      if (error.response && error.response.status === 429) {
        // If we hit the rate limit, wait and try again
        await new Promise(resolve => setTimeout(resolve, 2000));
        return this.processRequest(config);
      }
      throw error;
    }
  }

  async waitForAvailableSlot() {
    const now = Date.now();
    if (now > this.resetTime) {
      this.requestsThisMinute = 0;
      this.resetTime = now + 60000;
    }

    if (this.requestsThisMinute >= this.maxRequestsPerMinute) {
      const waitTime = this.resetTime - now;
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return this.waitForAvailableSlot();
    }

    this.requestsThisMinute++;
  }
}

const dexScreenerLimiter = new DexScreenerRateLimiter();

const rateLimitedDexScreenerAxios = async (config) => {
  return dexScreenerLimiter.makeRequest(config);
};

module.exports = { rateLimitedDexScreenerAxios };