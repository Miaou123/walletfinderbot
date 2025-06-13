// Working HeliusRateLimiter - Fixed configuration based on successful tests
const Bottleneck = require('bottleneck');
const axios = require('axios');
const https = require('https');
const logger = require('../../utils/logger');

class HeliusRateLimiter {
  constructor() {
    // Create a simple, working HTTPS agent (same config as successful Node.js test)
    this.httpsAgent = new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 1000,
      maxSockets: 10,
      maxFreeSockets: 5,
      timeout: 30000
    });

    // Conservative rate limiting (well under your Business tier limits)
    this.rpcLimiter = new Bottleneck({
      reservoir: 50,              // 50 requests per second
      reservoirRefreshAmount: 50,
      reservoirRefreshInterval: 1000,
      maxConcurrent: 10,          // 10 concurrent requests
      minTime: 20                 // 20ms between requests
    });
    
    this.apiLimiter = new Bottleneck({
      reservoir: 20,              // 20 requests per second for API calls
      reservoirRefreshAmount: 20,
      reservoirRefreshInterval: 1000,
      maxConcurrent: 5,           // 5 concurrent API requests
      minTime: 50                 // 50ms between API requests
    });

    this.defaultTimeout = 30000;  // 30 seconds (matches successful test)
    this.maxRetries = 3;

    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      timeoutRequests: 0,
      lastSuccessTime: Date.now()
    };

    logger.info('Helius RateLimiter initialized with working configuration');
  }

  async rateLimitedAxios(requestConfig, apiType = 'rpc', context = {}) {
    const limiter = apiType === 'api' ? this.apiLimiter : this.rpcLimiter;
    const requestId = Math.random().toString(36).substring(7);
    
    return limiter.schedule(async () => {
      return this.executeRequest(requestConfig, requestId);
    });
  }

  async executeRequest(config, requestId) {
    this.stats.totalRequests++;

    try {
      // Use the same configuration that works in our Node.js test
      const enhancedConfig = {
        ...config,
        httpsAgent: this.httpsAgent,
        timeout: this.defaultTimeout,
        headers: {
          ...config.headers,
          'Content-Type': 'application/json',
          'User-Agent': 'WalletFinderBot/1.0',
          'Accept': 'application/json',
          'Connection': 'keep-alive'
        },
        // Important: These Axios-specific settings prevent common timeout issues
        maxRedirects: 5,
        validateStatus: (status) => status < 500,  // Don't throw on 4xx errors
        decompress: true,
        // Disable Axios transformations that can cause issues
        transformRequest: [(data) => {
          return typeof data === 'string' ? data : JSON.stringify(data);
        }],
        transformResponse: [(data) => {
          try {
            return typeof data === 'string' ? JSON.parse(data) : data;
          } catch (e) {
            return data;
          }
        }]
      };

      logger.debug(`[${requestId}] Making request to ${config.url?.substring(0, 50)}...`);
      
      const response = await axios(enhancedConfig);

      if (!response || !response.data) {
        throw new Error('Empty response received from Helius');
      }

      // Success
      this.stats.successfulRequests++;
      this.stats.lastSuccessTime = Date.now();
      
      logger.debug(`[${requestId}] Request successful`);
      return response;

    } catch (error) {
      this.stats.failedRequests++;
      
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        this.stats.timeoutRequests++;
      }

      logger.error(`[${requestId}] Request failed:`, {
        message: error.message,
        code: error.code,
        status: error.response?.status,
        timeout: error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'
      });

      return null;
    }
  }

  getStats() {
    const total = this.stats.totalRequests || 1;
    const timeSinceLastSuccess = Date.now() - this.stats.lastSuccessTime;
    
    return {
      ...this.stats,
      rpcQueueSize: this.rpcLimiter.counts().QUEUED,
      apiQueueSize: this.apiLimiter.counts().QUEUED,
      rpcRunning: this.rpcLimiter.counts().RUNNING,
      apiRunning: this.apiLimiter.counts().RUNNING,
      successRate: `${((this.stats.successfulRequests / total) * 100).toFixed(2)}%`,
      failureRate: `${((this.stats.failedRequests / total) * 100).toFixed(2)}%`,
      timeoutRate: `${((this.stats.timeoutRequests / total) * 100).toFixed(2)}%`,
      timeSinceLastSuccess: timeSinceLastSuccess,
      isHealthy: timeSinceLastSuccess < 60000 // Healthy if success in last minute
    };
  }

  async stop() {
    logger.info('Stopping Helius RateLimiter...');
    
    // Close the HTTPS agent
    this.httpsAgent.destroy();
    
    await Promise.all([
      this.rpcLimiter.stop(),
      this.apiLimiter.stop()
    ]);
    
    logger.info('Helius RateLimiter stopped');
  }
}

module.exports = new HeliusRateLimiter();
