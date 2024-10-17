const Bottleneck = require('bottleneck');
const logger = require('../logger');

class PumpfunRateLimiter {
  constructor(maxRequestsPerSecond) {
    this.limiter = new Bottleneck({
      reservoir: maxRequestsPerSecond,
      reservoirRefreshAmount: maxRequestsPerSecond,
      reservoirRefreshInterval: 1000,
      maxConcurrent: 5,
      minTime: 1,
    });

    this.retryOptions = {
      retries: 3,
      initialDelay: 1000,
      backoffFactor: 2,
      maxDelay: 15000, 
      timeout: 120000, 
    };
  }

  async enqueue(requestFunction) {
    const task = async () => {
      let retries = this.retryOptions.retries;
      let delay = this.retryOptions.initialDelay;
      const startTime = Date.now();

      while (true) {
        try {
          const result = await Promise.race([
            requestFunction(),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Request timeout')), this.retryOptions.timeout)
            )
          ]);
          return result;
        } catch (error) {
          retries -= 1;
          if (retries <= 0 || Date.now() - startTime > this.retryOptions.timeout) {
            logger.error(`Task failed after all retries or timeout: ${error.message}`);
            logger.error(`Full error details:`, error);
            throw error;
          }
          logger.warn(`Task failed: ${error.message}. Retrying in ${delay}ms...`);
          logger.debug(`Full error details for retry:`, error);
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay = Math.min(delay * this.retryOptions.backoffFactor, this.retryOptions.maxDelay);
        }
      }
    };

    return this.limiter.schedule(() => task());
  }
}

module.exports = new PumpfunRateLimiter(20);