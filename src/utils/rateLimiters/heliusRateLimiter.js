// heliusRateLimiter.js
const Bottleneck = require('bottleneck');
const axios = require('axios');
const logger = require('../../utils/logger');

class HeliusRateLimiter {
  constructor() {
    // Updated for Business tier: 200 RPC requests/s
    this.rpcLimiter = new Bottleneck({
      reservoir: 200,             // 200 requests allowed per second
      reservoirRefreshAmount: 200, // Replenish 200 permits
      reservoirRefreshInterval: 1000, // Every 1 second (1000ms)
      maxConcurrent: 20,          // Increased parallel requests
      minTime: 5                  // Minimum 5ms between requests
    });
    
    // Updated for Business tier: 50 API requests/s (DAS & Enhanced)
    this.apiLimiter = new Bottleneck({
      reservoir: 50,              // 50 requests allowed per second
      reservoirRefreshAmount: 50,  // Replenish 50 permits
      reservoirRefreshInterval: 1000, // Every 1 second (1000ms)
      maxConcurrent: 15,          // Increased parallel requests
      minTime: 20                 // Minimum 20ms between requests
    });

    this.requestQueue = {
      rpc: new Map(),
      api: new Map()
    };

    this.stats = {
      totalRequests: 0,
      failedRequests: 0,
      timeoutRequests: 0,
      nullResponseErrors: 0,
      longTermStorageErrors: 0,
      retrySuccesses: 0, 
    };

    this.defaultTimeout = 45000;

    // Start automatic batch processing
    setInterval(() => this.processBatches(), 100);
  }

  getRequestKey(config) {
    const method = config.data?.method || '';
    const baseParams = config.data?.params?.[0] || '';
    return `${method}_${typeof baseParams === 'string' ? baseParams : JSON.stringify(baseParams)}`;
  }

  async rateLimitedAxios(requestConfig, apiType, context = {}) {
    const requestId = Math.random().toString(36).substring(7);
    const requestKey = this.getRequestKey(requestConfig);
    
    return new Promise((resolve, reject) => {
      if (!this.requestQueue[apiType].has(requestKey)) {
        this.requestQueue[apiType].set(requestKey, []);
      }
      
      this.requestQueue[apiType].get(requestKey).push({
        config: requestConfig,
        context,
        requestId,
        resolve,
        reject,
        timestamp: Date.now()
      });
    });
  }

  async processBatches() {
    for (const apiType of ['rpc', 'api']) {
      for (const [key, requests] of this.requestQueue[apiType].entries()) {
        if (requests.length === 0) {
          this.requestQueue[apiType].delete(key);
          continue;
        }

        // Increased batch size to handle higher throughput
        const batch = requests.splice(0, apiType === 'rpc' ? 40 : 20);
        this.processBatch(batch, apiType);
      }
    }
  }

  async processBatch(batch, apiType) {
    const limiter = apiType === 'api' ? this.apiLimiter : this.rpcLimiter;
    
    try {
      const promises = batch.map(request => 
        limiter.schedule(() => this.executeRequest(request))
      );

      const results = await Promise.all(promises);
      
      batch.forEach((request, index) => {
        request.resolve(results[index]);
      });
    } catch (error) {
      logger.error('Batch processing error:', error);
      batch.forEach(request => request.reject(error));
    }
  }

  async executeRequest(request, attempt = 1) {
    const { config, requestId, context } = request;
    const maxAttempts = 5;
    const startTime = Date.now();
    this.stats.totalRequests++;
  
    try {
      // Gradually increase timeout based on attempt number
      const dynamicTimeout = (config.timeout || this.defaultTimeout) * Math.min(attempt, 2);
      
      const response = await axios({
        ...config,
        timeout: dynamicTimeout
      });
  
      if (!response || !response.data) {
        this.stats.nullResponseErrors++;
        return null;
      }
  
      if (this.isHeliusError(response.data)) {
        if (this.isLongTermStorageError(response.data.error)) {
          this.stats.longTermStorageErrors++;
          return null;
        }
        this.stats.failedRequests++;
        return null;
      }
  
      // Count successful retries
      if (attempt > 1) {
        this.stats.retrySuccesses++;
      }
      
      return response;
  
    } catch (error) {
      // Check if this is a rate limit error (429) or a timeout
      const isTimeout = error.code === 'ECONNABORTED' || error.message.includes('timeout');
      
      if ((error.response && error.response.status === 429 || isTimeout) && attempt < maxAttempts) {
        // Exponential backoff with jitter to reduce load spikes
        const baseDelay = Math.pow(2, attempt) * 1000;
        const jitter = Math.random() * 1000;
        const delay = Math.min(baseDelay + jitter, 30000);
        
        const errorType = isTimeout ? "timeout" : "rate limit";
        logger.warn(`${errorType} hit. Attempt ${attempt}/${maxAttempts}. Waiting ${Math.round(delay/1000)}s before retry.`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.executeRequest(request, attempt + 1);
      }
      
      if (error.code === 'ECONNABORTED') {
        this.stats.timeoutRequests++;
      }
      
      this.stats.failedRequests++;
      logger.error(`[${requestId}] Request failed (attempt ${attempt}/${maxAttempts}):`, error.message);
      return null;
    }
  }
  
  isHeliusError(response) {
    return response && response.jsonrpc === '2.0' && response.error;
  }

  isLongTermStorageError(error) {
    return error?.code === -32019 || 
           error?.message?.includes('Failed to query long-term storage');
  }

  getStats() {
    const total = this.stats.totalRequests || 1;
    return {
      ...this.stats,
      failureRate: `${((this.stats.failedRequests / total) * 100).toFixed(2)}%`,
      timeoutRate: `${((this.stats.timeoutRequests / total) * 100).toFixed(2)}%`,
      nullResponseRate: `${((this.stats.nullResponseErrors / total) * 100).toFixed(2)}%`,
      longTermStorageRate: `${((this.stats.longTermStorageErrors / total) * 100).toFixed(2)}%`,
    };
  }

  resetStats() {
    this.stats = {
      totalRequests: 0,
      failedRequests: 0,
      timeoutRequests: 0,
      nullResponseErrors: 0,
      longTermStorageErrors: 0,
      retrySuccesses: 0,
    };
  }
}

module.exports = new HeliusRateLimiter();