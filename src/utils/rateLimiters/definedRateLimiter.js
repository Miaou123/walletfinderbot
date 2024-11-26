const Bottleneck = require('bottleneck');
const axios = require('axios');

class DefinedRateLimiter {
  constructor() {
    this.limiter = new Bottleneck({
      reservoir: 300, // 300 requests per second
      reservoirRefreshAmount: 300,
      reservoirRefreshInterval: 1000, // Refresh every second
      maxConcurrent: 500, // 500 concurrent requests
      minTime: Math.ceil(1000 / 300), // Ensure we don't exceed 300 RPS
    });

    this.retryOptions = {
      retries: 3, // Nombre de retries
      initialDelay: 1000, // Délai initial de 1 seconde
      backoffFactor: 2, // Facteur de backoff exponentiel
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
            throw error;
          }
          if (this.isRetryableError(error)) {
            console.warn(`Codex API request failed: ${error.message}. Retrying in ${delay}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
            delay *= this.retryOptions.backoffFactor;
          } else {
            throw error; // Ne pas retry pour les erreurs non récupérables
          }
        }
      }
    };

    return this.limiter.schedule(() => task());
  }

  isRetryableError(error) {
    if (error.isAxiosError) {
      // Pour les erreurs Axios
      return !error.response || error.response.status >= 500 || error.code === 'ECONNABORTED';
    } else {
      // Pour d'autres types d'erreurs
      return true; // Vous pouvez affiner cette logique selon vos besoins
    }
  }
}

module.exports = new DefinedRateLimiter();