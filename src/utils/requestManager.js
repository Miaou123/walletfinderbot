const NodeCache = require('node-cache');
const pLimit = require('p-limit');
const logger = require('./logger');

/**
 * RequestManager - Centralized utility for managing API requests
 * Provides caching, rate limiting, and batch processing
 */
class RequestManager {
  constructor(options = {}) {
    // Initialize cache
    this.cache = new NodeCache({
      stdTTL: options.cacheTTL || 300, // Default 5 minutes
      checkperiod: options.checkPeriod || 60, // Check for expired keys every minute
      useClones: false
    });
    
    // Set up rate limiters for different operations
    this.limits = {
      default: pLimit(options.concurrency || 5), // Default max 5 concurrent requests
      read: pLimit(options.readConcurrency || 10),    // Higher concurrency for reads
      write: pLimit(options.writeConcurrency || 3),   // Lower concurrency for writes
    };
    
    // Set up default cache times for different types of data
    this.cacheTimes = {
      short: 60,        // 1 minute
      medium: 300,      // 5 minutes
      long: 1800,       // 30 minutes
      veryLong: 86400,  // 24 hours
      ...options.cacheTimes
    };
  }
  
  /**
   * Execute a function with caching
   * @param {string} key - Cache key
   * @param {Function} fn - Function to execute if cache miss
   * @param {Object} options - Options for caching and execution
   * @returns {Promise<any>} Result from cache or function execution
   */
  async withCache(key, fn, options = {}) {
    const {
      ttl = this.cacheTimes.medium,
      forceRefresh = false,
      onError = null
    } = options;
    
    // Check cache first (unless forced refresh)
    if (!forceRefresh) {
      const cachedValue = this.cache.get(key);
      if (cachedValue !== undefined) {
        logger.debug(`Cache hit for key: ${key}`);
        return cachedValue;
      }
    }
    
    // Execute the function with rate limiting
    try {
      const limitType = options.limitType || 'default';
      const limit = this.limits[limitType] || this.limits.default;
      
      const result = await limit(async () => {
        logger.debug(`Cache miss for key: ${key}, executing function`);
        return await fn();
      });
      
      // Cache the result
      if (result !== undefined && result !== null) {
        this.cache.set(key, result, ttl);
      }
      
      return result;
    } catch (error) {
      logger.error(`Error executing function for key ${key}:`, error);
      
      // Use custom error handler if provided
      if (onError && typeof onError === 'function') {
        return onError(error);
      }
      
      // Return cached value even if expired as fallback
      const fallbackValue = this.cache.get(key, true);
      if (fallbackValue !== undefined) {
        logger.debug(`Using expired cache value for key: ${key} due to error`);
        return fallbackValue;
      }
      
      throw error;
    }
  }
  
  /**
   * Execute a function with retries
   * @param {Function} fn - Function to execute
   * @param {Object} options - Retry options
   * @returns {Promise<any>} Result from function execution
   */
  async withRetry(fn, options = {}) {
    const {
      maxAttempts = 3,
      delay = 1000,
      backoffFactor = 2,
      retryableErrors = []
    } = options;
    
    let lastError;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        
        // Check if error is retryable
        const shouldRetry = 
          attempt < maxAttempts && 
          (retryableErrors.length === 0 || 
           retryableErrors.some(errType => error instanceof errType || 
                               (error.name && error.name === errType.name)));
        
        if (!shouldRetry) {
          break;
        }
        
        // Calculate delay with exponential backoff
        const retryDelay = delay * Math.pow(backoffFactor, attempt - 1);
        logger.debug(`Retrying operation, attempt ${attempt}/${maxAttempts} after ${retryDelay}ms`);
        
        // Wait before next attempt
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
    
    throw lastError;
  }
  
  /**
   * Execute multiple functions in batches
   * @param {Array<Function>} fns - Array of functions to execute
   * @param {Object} options - Batch options
   * @returns {Promise<Array<any>>} Results from function executions
   */
  async batch(fns, options = {}) {
    const {
      batchSize = 5,
      limitType = 'default'
    } = options;
    
    if (!Array.isArray(fns) || fns.length === 0) {
      return [];
    }
    
    const limit = this.limits[limitType] || this.limits.default;
    const results = [];
    
    // Process in batches
    for (let i = 0; i < fns.length; i += batchSize) {
      const batch = fns.slice(i, i + batchSize);
      const batchPromises = batch.map(fn => limit(() => fn()));
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      batchResults.forEach(result => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({ error: result.reason });
        }
      });
    }
    
    return results;
  }
  
  /**
   * Clear cache entry for a specific key
   * @param {string} key - Cache key to invalidate
   */
  invalidate(key) {
    this.cache.del(key);
    logger.debug(`Invalidated cache for key: ${key}`);
  }
  
  /**
   * Clear cache entries matching a pattern
   * @param {string} pattern - Pattern to match against keys
   */
  invalidatePattern(pattern) {
    const keys = this.cache.keys();
    const regex = new RegExp(pattern);
    
    let count = 0;
    keys.forEach(key => {
      if (regex.test(key)) {
        this.cache.del(key);
        count++;
      }
    });
    
    logger.debug(`Invalidated ${count} cache entries matching pattern: ${pattern}`);
  }
  
  /**
   * Clear all cache entries
   */
  clearCache() {
    this.cache.flushAll();
    logger.debug('Cache cleared completely');
  }
  
  /**
   * Get statistics about the cache
   * @returns {Object} Cache statistics
   */
  getStats() {
    return {
      keys: this.cache.keys().length,
      hits: this.cache.getStats().hits,
      misses: this.cache.getStats().misses,
      ksize: this.cache.getStats().ksize,
      vsize: this.cache.getStats().vsize
    };
  }
}

// Export a singleton instance with default options
module.exports = new RequestManager({
  cacheTimes: {
    tokenInfo: 300,           // 5 minutes
    tokenHolders: 600,        // 10 minutes
    walletData: 1800,         // 30 minutes
    transactions: 300,        // 5 minutes
    prices: 60,               // 1 minute
    marketData: 120,          // 2 minutes
    staticData: 86400,        // 24 hours
  }
});