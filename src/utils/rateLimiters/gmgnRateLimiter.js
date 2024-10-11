const Bottleneck = require('bottleneck');

class GmgnRateLimiter {
  constructor(maxRequestsPerSecond) {
    this.limiter = new Bottleneck({
      reservoir: maxRequestsPerSecond,
      reservoirRefreshAmount: maxRequestsPerSecond,
      reservoirRefreshInterval: 1000,
      maxConcurrent: 5,
      minTime: 0,
    });

    this.retryOptions = {
      retries: 5,
      initialDelay: 1000,
      backoffFactor: 2,
      maxDelay: 30000, // Maximum delay of 30 seconds
      timeout: 300000, // 5 minutes timeout
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
            console.error(`Task failed after all retries or timeout: ${error.message}`);
            throw error;
          }
          console.warn(`Task failed: ${error.message}. Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay = Math.min(delay * this.retryOptions.backoffFactor, this.retryOptions.maxDelay);
        }
      }
    };

    return this.limiter.schedule(() => task());
  }
}

module.exports = new GmgnRateLimiter(30);