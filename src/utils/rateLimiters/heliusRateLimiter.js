// heliusRateLimiter.js
const Bottleneck = require('bottleneck');
const axios = require('axios');
const logger = require('../../utils/logger');

class HeliusRateLimiter {
  constructor() {
    this.rpcLimiter = new Bottleneck({
      reservoir: 50,            // 50 requests allowed
      reservoirRefreshAmount: 50, // Replenish 50 permits
      reservoirRefreshInterval: 1000, // Every 1 second (1000ms)
      maxConcurrent: 10,        // Only 10 requests in parallel
      minTime: 20               // Minimum 20ms between requests
    });
    
    this.apiLimiter = new Bottleneck({
      reservoir: 10,            // 10 requests allowed 
      reservoirRefreshAmount: 10, // Replenish 10 permits
      reservoirRefreshInterval: 1000, // Every 1 second (1000ms)
      maxConcurrent: 5,         // Only 5 requests in parallel 
      minTime: 100              // Minimum 100ms between requests
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
    };

    this.defaultTimeout = 15000;

    // Démarrer le traitement automatique des batchs
    setInterval(() => this.processBatches(), 50);
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

        const batch = requests.splice(0, 50);
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
      const response = await axios({
        ...config,
        timeout: config.timeout || this.defaultTimeout
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
  
      return response;
  
    } catch (error) {
      // Check if this is a rate limit error (429)
      if (error.response && error.response.status === 429 && attempt < maxAttempts) {
        const delay = Math.min(Math.pow(2, attempt) * 1000 + Math.random() * 1000, 30000);
        logger.warn(`Rate limit hit. Attempt ${attempt}/${maxAttempts}. Waiting ${Math.round(delay/1000)}s before retry.`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.executeRequest(request, attempt + 1);
      }
      
      if (error.code === 'ECONNABORTED') {
        this.stats.timeoutRequests++;
      }
      this.stats.failedRequests++;
      logger.error(`[${requestId}] Request failed:`, error);
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
    };
  }
}

module.exports = new HeliusRateLimiter();