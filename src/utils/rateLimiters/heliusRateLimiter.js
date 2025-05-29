// heliusRateLimiter.js
const Bottleneck = require('bottleneck');
const axios = require('axios');
const logger = require('../../utils/logger');

class HeliusRateLimiter {
  constructor() {
    // Updated for Business tier: 200 RPC requests/s
    this.rpcLimiter = new Bottleneck({
      reservoir: 200,
      reservoirRefreshAmount: 200,
      reservoirRefreshInterval: 1000,
      maxConcurrent: 20,
      minTime: 5
    });
    
    // Updated for Business tier: 50 API requests/s (DAS & Enhanced)
    this.apiLimiter = new Bottleneck({
      reservoir: 50,
      reservoirRefreshAmount: 50,
      reservoirRefreshInterval: 1000,
      maxConcurrent: 15,
      minTime: 20
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
    this.processingBatches = false; // Add flag to prevent race conditions

    // Start automatic batch processing with race condition protection
    setInterval(() => {
      if (!this.processingBatches) {
        this.processBatches();
      }
    }, 100);
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
      // Add timeout for queued requests
      const timeoutId = setTimeout(() => {
        reject(new Error('Request timeout in queue'));
      }, 60000); // 60 second queue timeout

      if (!this.requestQueue[apiType].has(requestKey)) {
        this.requestQueue[apiType].set(requestKey, []);
      }
      
      this.requestQueue[apiType].get(requestKey).push({
        config: requestConfig,
        context,
        requestId,
        resolve: (result) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        },
        timestamp: Date.now()
      });
    });
  }

  async processBatches() {
    if (this.processingBatches) return;
    this.processingBatches = true;

    try {
      for (const apiType of ['rpc', 'api']) {
        const keysToProcess = [...this.requestQueue[apiType].keys()];
        
        for (const key of keysToProcess) {
          const requests = this.requestQueue[apiType].get(key);
          if (!requests || requests.length === 0) {
            this.requestQueue[apiType].delete(key);
            continue;
          }

          // Remove old requests (older than 5 minutes)
          const now = Date.now();
          const validRequests = requests.filter(req => now - req.timestamp < 300000);
          
          if (validRequests.length === 0) {
            this.requestQueue[apiType].delete(key);
            continue;
          }

          // Process batch
          const batchSize = apiType === 'rpc' ? 40 : 20;
          const batch = validRequests.splice(0, batchSize);
          
          if (batch.length > 0) {
            // Don't await here to allow parallel processing
            this.processBatch(batch, apiType).catch(error => {
              logger.error('Batch processing error:', error);
            });
          }

          // Update the queue
          if (validRequests.length === 0) {
            this.requestQueue[apiType].delete(key);
          } else {
            this.requestQueue[apiType].set(key, validRequests);
          }
        }
      }
    } finally {
      this.processingBatches = false;
    }
  }

  async processBatch(batch, apiType) {
    const limiter = apiType === 'api' ? this.apiLimiter : this.rpcLimiter;
    
    // Process each request individually to avoid Promise.all issues
    const promises = batch.map(async (request) => {
      try {
        const result = await limiter.schedule(() => this.executeRequest(request));
        request.resolve(result);
        return result;
      } catch (error) {
        request.reject(error);
        throw error;
      }
    });

    // Use Promise.allSettled to handle individual failures
    const results = await Promise.allSettled(promises);
    
    // Log any rejected promises for debugging
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        logger.debug(`Batch request ${index} failed:`, result.reason?.message);
      }
    });
  }

  async executeRequest(request, attempt = 1) {
    const { config, requestId, context } = request;
    const maxAttempts = 5;
    const startTime = Date.now();
    this.stats.totalRequests++;

    try {
      // Add debug logging for null responses
      logger.debug(`[${requestId}] Executing request attempt ${attempt}`, {
        method: config.data?.method,
        hasParams: !!config.data?.params,
        timeout: config.timeout || this.defaultTimeout
      });

      const dynamicTimeout = (config.timeout || this.defaultTimeout) * Math.min(attempt, 2);
      
      const response = await axios({
        ...config,
        timeout: dynamicTimeout
      });

      // More detailed null response checking
      if (!response) {
        logger.warn(`[${requestId}] Axios returned null/undefined response`);
        this.stats.nullResponseErrors++;
        return null;
      }

      if (!response.data) {
        logger.warn(`[${requestId}] Response has no data property`, {
          status: response.status,
          statusText: response.statusText
        });
        this.stats.nullResponseErrors++;
        return null;
      }

      // Check for Helius-specific errors
      if (this.isHeliusError(response.data)) {
        logger.debug(`[${requestId}] Helius API error:`, response.data.error);
        
        if (this.isLongTermStorageError(response.data.error)) {
          this.stats.longTermStorageErrors++;
          return null;
        }
        
        this.stats.failedRequests++;
        return null;
      }

      // Success case
      if (attempt > 1) {
        this.stats.retrySuccesses++;
        logger.debug(`[${requestId}] Retry successful on attempt ${attempt}`);
      }
      
      return response;

    } catch (error) {
      const isTimeout = error.code === 'ECONNABORTED' || error.message.includes('timeout');
      const isRateLimit = error.response && error.response.status === 429;
      
      if ((isRateLimit || isTimeout) && attempt < maxAttempts) {
        const baseDelay = Math.pow(2, attempt) * 1000;
        const jitter = Math.random() * 1000;
        const delay = Math.min(baseDelay + jitter, 30000);
        
        const errorType = isTimeout ? "timeout" : "rate limit";
        logger.warn(`[${requestId}] ${errorType} hit. Attempt ${attempt}/${maxAttempts}. Waiting ${Math.round(delay/1000)}s before retry.`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.executeRequest(request, attempt + 1);
      }
      
      // Final failure
      if (error.code === 'ECONNABORTED') {
        this.stats.timeoutRequests++;
      }
      
      this.stats.failedRequests++;
      logger.error(`[${requestId}] Final request failure (attempt ${attempt}/${maxAttempts}):`, {
        message: error.message,
        code: error.code,
        status: error.response?.status
      });
      
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
      queueSizes: {
        rpc: this.requestQueue.rpc.size,
        api: this.requestQueue.api.size
      }
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

  // Add method to check queue health
  getQueueHealth() {
    const now = Date.now();
    let totalQueuedRequests = 0;
    let oldRequests = 0;

    for (const apiType of ['rpc', 'api']) {
      for (const requests of this.requestQueue[apiType].values()) {
        totalQueuedRequests += requests.length;
        oldRequests += requests.filter(req => now - req.timestamp > 60000).length;
      }
    }

    return {
      totalQueuedRequests,
      oldRequests,
      processingBatches: this.processingBatches,
      healthy: oldRequests < 10 // Consider unhealthy if > 10 old requests
    };
  }
}

module.exports = new HeliusRateLimiter();