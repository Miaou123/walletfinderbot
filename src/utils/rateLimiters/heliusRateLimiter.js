// heliusRateLimiter.js - SIMPLIFIED VERSION
const Bottleneck = require('bottleneck');
const axios = require('axios');
const logger = require('../../utils/logger');

class HeliusRateLimiter {
  constructor() {
    // RPC Limiter - slightly under Helius Business tier limits
    this.rpcLimiter = new Bottleneck({
      reservoir: 180,           // 180/s (under 200/s limit)
      reservoirRefreshAmount: 180,
      reservoirRefreshInterval: 1000,
      maxConcurrent: 25,        // Good concurrency
      minTime: 0                // No artificial delays
    });
    
    // API Limiter - for DAS & Enhanced APIs
    this.apiLimiter = new Bottleneck({
      reservoir: 45,            // 45/s (under 50/s limit)
      reservoirRefreshAmount: 45,
      reservoirRefreshInterval: 1000,
      maxConcurrent: 15,
      minTime: 0
    });

    // Simple stats tracking
    this.stats = {
      totalRequests: 0,
      failedRequests: 0,
      timeoutRequests: 0,
      retrySuccesses: 0,
    };

    this.defaultTimeout = 30000;
  }

  async rateLimitedAxios(requestConfig, apiType = 'rpc', context = {}) {
    const limiter = apiType === 'api' ? this.apiLimiter : this.rpcLimiter;
    const requestId = Math.random().toString(36).substring(7);
    
    return limiter.schedule(async () => {
      return this.executeRequestWithRetry(requestConfig, requestId);
    });
  }

  async executeRequestWithRetry(config, requestId, attempt = 1) {
    const maxAttempts = 3;
    this.stats.totalRequests++;

    try {
      const response = await axios({
        ...config,
        timeout: this.defaultTimeout,
        headers: {
          ...config.headers,
          'Connection': 'keep-alive'
        }
      });

      // Basic response validation
      if (!response || !response.data) {
        logger.warn(`[${requestId}] Invalid response received`);
        
        if (attempt < maxAttempts) {
          await this.delay(1000 * attempt);
          return this.executeRequestWithRetry(config, requestId, attempt + 1);
        }
        return null;
      }

      // Check for Helius-specific errors
      if (this.isHeliusError(response.data)) {
        const error = response.data.error;
        
        // Retry certain Helius errors
        if (this.isRetryableHeliusError(error) && attempt < maxAttempts) {
          logger.debug(`[${requestId}] Retryable Helius error: ${error.message}`);
          await this.delay(2000 * attempt);
          return this.executeRequestWithRetry(config, requestId, attempt + 1);
        }
        
        logger.debug(`[${requestId}] Helius error (not retrying): ${error.message || error.code}`);
        return null;
      }

      // Success
      if (attempt > 1) {
        this.stats.retrySuccesses++;
        logger.debug(`[${requestId}] Success on attempt ${attempt}`);
      }

      return response;

    } catch (error) {
      // Determine if we should retry this error
      if (this.shouldRetryError(error) && attempt < maxAttempts) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000); // Exponential backoff, max 8s
        
        logger.warn(`[${requestId}] ${error.code || error.message} - Retry ${attempt}/${maxAttempts} in ${delay/1000}s`);
        
        await this.delay(delay);
        return this.executeRequestWithRetry(config, requestId, attempt + 1);
      }

      // Final failure
      this.stats.failedRequests++;
      
      if (error.code === 'ECONNABORTED') {
        this.stats.timeoutRequests++;
      }

      logger.error(`[${requestId}] Request failed after ${attempt} attempts:`, {
        message: error.message,
        code: error.code,
        status: error.response?.status,
        url: config.url
      });

      // Return null for compatibility with existing code
      return null;
    }
  }

  shouldRetryError(error) {
    // Network errors that are worth retrying
    const retryableNetworkCodes = [
      'ECONNRESET',     // Connection reset
      'ETIMEDOUT',      // Request timeout
      'ECONNABORTED',   // Request aborted
      'ENOTFOUND',      // DNS lookup failed
      'EAI_AGAIN',      // DNS temporary failure
      'EPIPE',          // Broken pipe
      'ECONNREFUSED'    // Connection refused
    ];
    
    const isNetworkError = retryableNetworkCodes.includes(error.code);
    const isRateLimit = error.response?.status === 429;
    const isServerError = error.response?.status >= 500;
    
    return isNetworkError || isRateLimit || isServerError;
  }

  isHeliusError(response) {
    return response && response.jsonrpc === '2.0' && response.error;
  }

  isRetryableHeliusError(error) {
    // Only retry server-side Helius errors, not client errors
    const retryableCodes = [
      -32603, // Internal error
      -32005, // Request failed  
      -32000, // Server error
      -32603  // Internal JSON-RPC error
    ];
    
    return retryableCodes.includes(error?.code);
  }

  isLongTermStorageError(error) {
    return error?.code === -32019 || 
           error?.message?.includes('Failed to query long-term storage');
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getStats() {
    const total = this.stats.totalRequests || 1;
    return {
      ...this.stats,
      rpcQueueSize: this.rpcLimiter.counts().QUEUED,
      apiQueueSize: this.apiLimiter.counts().QUEUED,
      rpcRunning: this.rpcLimiter.counts().RUNNING,
      apiRunning: this.apiLimiter.counts().RUNNING,
      failureRate: `${((this.stats.failedRequests / total) * 100).toFixed(2)}%`,
      timeoutRate: `${((this.stats.timeoutRequests / total) * 100).toFixed(2)}%`,
      retrySuccessRate: `${((this.stats.retrySuccesses / total) * 100).toFixed(2)}%`
    };
  }

  resetStats() {
    this.stats = {
      totalRequests: 0,
      failedRequests: 0,
      timeoutRequests: 0,
      retrySuccesses: 0,
    };
  }

  getQueueHealth() {
    const rpcCounts = this.rpcLimiter.counts();
    const apiCounts = this.apiLimiter.counts();
    
    return {
      rpc: {
        queued: rpcCounts.QUEUED,
        running: rpcCounts.RUNNING,
        done: rpcCounts.DONE
      },
      api: {
        queued: apiCounts.QUEUED,
        running: apiCounts.RUNNING,
        done: apiCounts.DONE
      },
      healthy: rpcCounts.QUEUED < 50 && apiCounts.QUEUED < 20 // Reasonable queue sizes
    };
  }

  // Optional: Get detailed Bottleneck status
  getBottleneckStatus() {
    return {
      rpc: {
        ...this.rpcLimiter.counts(),
        reservoir: this.rpcLimiter.reservoir()
      },
      api: {
        ...this.apiLimiter.counts(),
        reservoir: this.apiLimiter.reservoir()
      }
    };
  }

  // Clean shutdown
  async stop() {
    logger.info('Stopping HeliusRateLimiter...');
    
    // Wait for all jobs to complete
    await Promise.all([
      this.rpcLimiter.stop(),
      this.apiLimiter.stop()
    ]);
    
    logger.info('HeliusRateLimiter stopped');
  }
}

module.exports = new HeliusRateLimiter();