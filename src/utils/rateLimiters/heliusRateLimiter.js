// Enhanced HeliusRateLimiter.js - Fixed version
const Bottleneck = require('bottleneck');
const axios = require('axios');
const logger = require('../../utils/logger');

class HeliusRateLimiter {
  constructor() {
    // More conservative rate limits to prevent timeouts
    this.rpcLimiter = new Bottleneck({
      reservoir: 120,           // Reduced from 180 to 120/s
      reservoirRefreshAmount: 120,
      reservoirRefreshInterval: 1000,
      maxConcurrent: 15,        // Reduced from 25 to 15
      minTime: 10               // Add small delay between requests
    });
    
    this.apiLimiter = new Bottleneck({
      reservoir: 30,            // Reduced from 45 to 30/s
      reservoirRefreshAmount: 30,
      reservoirRefreshInterval: 1000,
      maxConcurrent: 8,         // Reduced from 15 to 8
      minTime: 25
    });

    // Enhanced timeout and retry settings
    this.defaultTimeout = 45000; // Increased from 30s to 45s
    this.maxRetries = 4;         // Increased from 3 to 4
    
    this.stats = {
      totalRequests: 0,
      failedRequests: 0,
      timeoutRequests: 0,
      retrySuccesses: 0,
      consecutiveFailures: 0,
      lastFailureTime: null
    };

    // Circuit breaker pattern
    this.circuitBreaker = {
      isOpen: false,
      failures: 0,
      threshold: 10,            // Open circuit after 10 consecutive failures
      timeout: 60000,           // Keep circuit open for 60 seconds
      halfOpenRequests: 0,
      maxHalfOpenRequests: 3
    };
  }

  // Circuit breaker logic
  isCircuitOpen() {
    if (!this.circuitBreaker.isOpen) return false;
    
    const now = Date.now();
    if (now - this.stats.lastFailureTime > this.circuitBreaker.timeout) {
      // Try to half-open the circuit
      if (this.circuitBreaker.halfOpenRequests < this.circuitBreaker.maxHalfOpenRequests) {
        logger.info('Circuit breaker: attempting half-open state');
        return false;
      }
    }
    return true;
  }

  recordSuccess() {
    this.stats.consecutiveFailures = 0;
    this.circuitBreaker.failures = 0;
    if (this.circuitBreaker.isOpen) {
      logger.info('Circuit breaker: closing circuit after successful request');
      this.circuitBreaker.isOpen = false;
      this.circuitBreaker.halfOpenRequests = 0;
    }
  }

  recordFailure() {
    this.stats.consecutiveFailures++;
    this.stats.lastFailureTime = Date.now();
    this.circuitBreaker.failures++;
    
    if (this.circuitBreaker.failures >= this.circuitBreaker.threshold) {
      logger.warn(`Circuit breaker: opening circuit after ${this.circuitBreaker.failures} failures`);
      this.circuitBreaker.isOpen = true;
      this.circuitBreaker.halfOpenRequests = 0;
    }
  }

  async rateLimitedAxios(requestConfig, apiType = 'rpc', context = {}) {
    // Check circuit breaker
    if (this.isCircuitOpen()) {
      logger.warn('Circuit breaker is open, rejecting request');
      return null;
    }

    const limiter = apiType === 'api' ? this.apiLimiter : this.rpcLimiter;
    const requestId = Math.random().toString(36).substring(7);
    
    // Add exponential backoff based on consecutive failures
    if (this.stats.consecutiveFailures > 0) {
      const backoffDelay = Math.min(1000 * Math.pow(2, this.stats.consecutiveFailures - 1), 10000);
      logger.debug(`Applying backoff delay: ${backoffDelay}ms due to ${this.stats.consecutiveFailures} consecutive failures`);
      await this.delay(backoffDelay);
    }
    
    return limiter.schedule(async () => {
      return this.executeRequestWithRetry(requestConfig, requestId, apiType);
    });
  }

  async executeRequestWithRetry(config, requestId, apiType, attempt = 1) {
    this.stats.totalRequests++;

    try {
      // Progressive timeout increase for retries
      const timeoutMultiplier = 1 + (attempt - 1) * 0.5; // 1x, 1.5x, 2x, 2.5x
      const requestTimeout = Math.min(this.defaultTimeout * timeoutMultiplier, 90000); // Max 90s

      const response = await axios({
        ...config,
        timeout: requestTimeout,
        headers: {
          ...config.headers,
          'Connection': 'keep-alive',
          'Keep-Alive': 'timeout=30'
        },
        // Add retry-specific headers
        'X-Request-ID': requestId,
        'X-Retry-Attempt': attempt.toString()
      });

      // Validate response
      if (!response || !response.data) {
        throw new Error('Empty response received from Helius');
      }

      // Check for Helius-specific errors
      if (this.isHeliusError(response.data)) {
        const error = response.data.error;
        
        // Handle specific Helius errors
        if (this.isRetryableHeliusError(error) && attempt < this.maxRetries) {
          const retryDelay = this.calculateRetryDelay(attempt, apiType);
          logger.debug(`[${requestId}] Helius error (retrying): ${error.message}, attempt ${attempt}/${this.maxRetries}, delay: ${retryDelay}ms`);
          await this.delay(retryDelay);
          return this.executeRequestWithRetry(config, requestId, apiType, attempt + 1);
        }
        
        logger.debug(`[${requestId}] Helius error (not retrying): ${error.message || error.code}`);
        this.recordFailure();
        return null;
      }

      // Success
      this.recordSuccess();
      if (attempt > 1) {
        this.stats.retrySuccesses++;
        logger.debug(`[${requestId}] Success on attempt ${attempt}`);
      }

      return response;

    } catch (error) {
      // Determine if we should retry
      if (this.shouldRetryError(error) && attempt < this.maxRetries) {
        const retryDelay = this.calculateRetryDelay(attempt, apiType, error);
        
        logger.warn(`[${requestId}] ${error.code || error.message} - Retry ${attempt}/${this.maxRetries} in ${retryDelay/1000}s`);
        
        await this.delay(retryDelay);
        return this.executeRequestWithRetry(config, requestId, apiType, attempt + 1);
      }

      // Final failure
      this.recordFailure();
      this.stats.failedRequests++;
      
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        this.stats.timeoutRequests++;
      }

      // Enhanced error logging
      logger.error(`[${requestId}] Request failed after ${attempt} attempts:`, {
        message: error.message,
        code: error.code,
        status: error.response?.status,
        url: config.url,
        timeout: error.code === 'ECONNABORTED',
        consecutiveFailures: this.stats.consecutiveFailures
      });

      return null;
    }
  }

  calculateRetryDelay(attempt, apiType, error = null) {
    // Base delay
    let baseDelay = apiType === 'api' ? 2000 : 1000;
    
    // Exponential backoff
    let delay = baseDelay * Math.pow(2, attempt - 1);
    
    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 1000;
    delay += jitter;
    
    // Special handling for specific errors
    if (error) {
      if (error.response?.status === 429) {
        delay *= 3; // Extra delay for rate limiting
      } else if (error.code === 'ETIMEDOUT') {
        delay *= 2; // Extra delay for timeouts
      }
    }
    
    // Cap maximum delay
    return Math.min(delay, 30000); // Max 30 seconds
  }

  shouldRetryError(error) {
    const retryableNetworkCodes = [
      'ECONNRESET',
      'ETIMEDOUT', 
      'ECONNABORTED',
      'ENOTFOUND',
      'EAI_AGAIN',
      'EPIPE',
      'ECONNREFUSED',
      'EHOSTUNREACH',
      'ENETUNREACH'
    ];
    
    const isNetworkError = retryableNetworkCodes.includes(error.code);
    const isRateLimit = error.response?.status === 429;
    const isServerError = error.response?.status >= 500;
    const isTimeout = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
    
    return isNetworkError || isRateLimit || isServerError || isTimeout;
  }

  isHeliusError(response) {
    return response && response.jsonrpc === '2.0' && response.error;
  }

  isRetryableHeliusError(error) {
    const retryableCodes = [
      -32603, // Internal error
      -32005, // Request failed  
      -32000, // Server error
      -32002, // Resource unavailable
      -32604, // Method not supported (sometimes temporary)
    ];
    
    // Also retry on long-term storage errors after a delay
    if (error?.code === -32019) {
      return true;
    }
    
    return retryableCodes.includes(error?.code);
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getStats() {
    const total = this.stats.totalRequests || 1;
    return {
      ...this.stats,
      circuitBreaker: {
        isOpen: this.circuitBreaker.isOpen,
        failures: this.circuitBreaker.failures,
        halfOpenRequests: this.circuitBreaker.halfOpenRequests
      },
      rpcQueueSize: this.rpcLimiter.counts().QUEUED,
      apiQueueSize: this.apiLimiter.counts().QUEUED,
      rpcRunning: this.rpcLimiter.counts().RUNNING,
      apiRunning: this.apiLimiter.counts().RUNNING,
      failureRate: `${((this.stats.failedRequests / total) * 100).toFixed(2)}%`,
      timeoutRate: `${((this.stats.timeoutRequests / total) * 100).toFixed(2)}%`,
      retrySuccessRate: `${((this.stats.retrySuccesses / total) * 100).toFixed(2)}%`
    };
  }

  // Enhanced health check
  getQueueHealth() {
    const rpcCounts = this.rpcLimiter.counts();
    const apiCounts = this.apiLimiter.counts();
    
    const rpcHealthy = rpcCounts.QUEUED < 30 && rpcCounts.RUNNING < 10;
    const apiHealthy = apiCounts.QUEUED < 15 && apiCounts.RUNNING < 5;
    const circuitHealthy = !this.circuitBreaker.isOpen;
    const consecutiveFailuresOk = this.stats.consecutiveFailures < 5;
    
    return {
      rpc: {
        queued: rpcCounts.QUEUED,
        running: rpcCounts.RUNNING,
        done: rpcCounts.DONE,
        healthy: rpcHealthy
      },
      api: {
        queued: apiCounts.QUEUED,
        running: apiCounts.RUNNING,
        done: apiCounts.DONE,
        healthy: apiHealthy
      },
      overall: {
        healthy: rpcHealthy && apiHealthy && circuitHealthy && consecutiveFailuresOk,
        circuitOpen: this.circuitBreaker.isOpen,
        consecutiveFailures: this.stats.consecutiveFailures
      }
    };
  }

  // Reset circuit breaker manually if needed
  resetCircuitBreaker() {
    this.circuitBreaker.isOpen = false;
    this.circuitBreaker.failures = 0;
    this.circuitBreaker.halfOpenRequests = 0;
    this.stats.consecutiveFailures = 0;
    logger.info('Circuit breaker manually reset');
  }

  async stop() {
    logger.info('Stopping HeliusRateLimiter...');
    
    await Promise.all([
      this.rpcLimiter.stop(),
      this.apiLimiter.stop()
    ]);
    
    logger.info('HeliusRateLimiter stopped');
  }
}

module.exports = new HeliusRateLimiter();