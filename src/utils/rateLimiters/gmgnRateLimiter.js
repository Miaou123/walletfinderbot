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
      retries: 3,
      initialDelay: 1000,
      backoffFactor: 2,
      maxDelay: 10000, // Maximum delay of 10 seconds
    };
  }

  async enqueue(requestFunction) {
    const task = async () => {
      let retries = this.retryOptions.retries;
      let delay = this.retryOptions.initialDelay;

      while (true) {
        try {
          return await requestFunction();
        } catch (error) {
          retries -= 1;
          if (retries <= 0) {
            console.error(`Task failed after all retries: ${error.message}`);
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