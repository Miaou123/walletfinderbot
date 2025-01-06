// heliusRateLimiter.js
const Bottleneck = require('bottleneck');
const axios = require('axios');
const logger = require('../../utils/logger');

class HeliusRateLimiter {
  constructor() {
    this.rpcLimiter = new Bottleneck({
      reservoir: 500,
      reservoirRefreshAmount: 500,
      reservoirRefreshInterval: 1000,
      maxConcurrent: 200,
      minTime: 2,
    });

    this.apiLimiter = new Bottleneck({
      reservoir: 100,
      reservoirRefreshAmount: 100,
      reservoirRefreshInterval: 1000,
      maxConcurrent: 50,
      minTime: 10,
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
    
    logger.debug(`[${requestId}] Queueing request: ${requestKey}`);

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

  async executeRequest(request) {
    const { config, requestId, context } = request;
    const startTime = Date.now();
    this.stats.totalRequests++;

    try {
      logger.debug(`[${requestId}] Executing request...`);
      
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

      logger.debug(`[${requestId}] Success in ${Date.now() - startTime}ms`);
      return response;

    } catch (error) {
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