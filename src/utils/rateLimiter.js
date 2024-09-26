const axios = require('axios');

class TokenBucket {
  constructor(capacity, fillPerSecond) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.fillPerSecond = fillPerSecond;
    this.lastFilled = Date.now();
  }

  refill() {
    const now = Date.now();
    const timePassed = (now - this.lastFilled) / 1000;
    const refillAmount = timePassed * this.fillPerSecond;
    this.tokens = Math.min(this.capacity, this.tokens + refillAmount);
    this.lastFilled = now;
    //console.log(`Tokens refilled. Current tokens: ${this.tokens.toFixed(2)}`);
  }

  take() {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      //console.log(`Token taken. Remaining tokens: ${this.tokens.toFixed(2)}`);
      return true;
    }
    console.log('No tokens available');
    return false;
  }

  getWaitTime() {
    this.refill();
    if (this.tokens >= 1) return 0;
    return (1 - this.tokens) / this.fillPerSecond * 1000;
  }
}

class RateLimiter {
  constructor(maxRPCRequests, maxAPIRequests, perSeconds) {
    this.rpcBucket = new TokenBucket(maxRPCRequests, maxRPCRequests / perSeconds);
    this.apiBucket = new TokenBucket(maxAPIRequests, maxAPIRequests / perSeconds);
    this.rpcQueue = [];
    this.apiQueue = [];
    this.processing = false;
  }

  async throttle(fn, isRPC) {
    return new Promise((resolve, reject) => {
      const bucket = isRPC ? this.rpcBucket : this.apiBucket;
      const queue = isRPC ? this.rpcQueue : this.apiQueue;

      if (bucket.take()) {
        fn().then(resolve).catch(reject);
      } else {
        queue.push({ fn, resolve, reject });
        if (!this.processing) {
          this.processQueue(isRPC);
        }
      }
    });
  }

  async processQueue(isRPC) {
    this.processing = true;
    const bucket = isRPC ? this.rpcBucket : this.apiBucket;
    const queue = isRPC ? this.rpcQueue : this.apiQueue;

    while (true) {
      if (queue.length === 0) {
        this.processing = false;
        return;
      }

      const waitTime = bucket.getWaitTime();
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      if (bucket.take()) {
        const { fn, resolve, reject } = queue.shift();
        fn().then(resolve).catch(reject);
      }
    }
  }
}

const rateLimiter = new RateLimiter(50, 10, 1);

const rateLimitedAxios = async (config, isRPC = true, retries = 3, initialDelay = 1000) => {
  let delay = initialDelay;
  for (let i = 0; i < retries; i++) {
    try {
      return await rateLimiter.throttle(() => axios({
        ...config,
        timeout: 30000, // Augmenter le timeout à 30 secondes
      }), isRPC);
    } catch (error) {
      if ((error.code === 'ECONNABORTED' || error.response?.status === 429 || error.code === 'ETIMEDOUT') && i < retries - 1) {
        console.log(`Request failed (${error.code || error.response?.status}). Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
      } else {
        throw error;
      }
    }
  }
  throw new Error(`Failed after ${retries} retries`);
};

module.exports = { rateLimitedAxios };