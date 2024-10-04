const Bottleneck = require('bottleneck');

class GmgnRateLimiter {
  constructor(maxRequestsPerSecond) {
    this.limiter = new Bottleneck({
      reservoir: maxRequestsPerSecond, // Nombre initial de requêtes
      reservoirRefreshAmount: maxRequestsPerSecond,
      reservoirRefreshInterval: 1000, // Rafraîchit chaque seconde
      maxConcurrent: 5, // Nombre maximum de requêtes simultanées
      minTime: 0, // Temps minimum entre les requêtes
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
          console.warn(`Task failed: ${error.message}. Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= this.retryOptions.backoffFactor;
        }
      }
    };

    return this.limiter.schedule(() => task());
  }
}

module.exports = new GmgnRateLimiter(30); // Ajustez le nombre selon votre limite
