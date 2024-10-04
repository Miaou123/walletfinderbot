const Bottleneck = require('bottleneck');
const axios = require('axios');

class DexScreenerRateLimiter {
  constructor(maxRequestsPerMinute) {
    this.limiter = new Bottleneck({
      reservoir: maxRequestsPerMinute, // Nombre initial de requêtes
      reservoirRefreshAmount: maxRequestsPerMinute,
      reservoirRefreshInterval: 60000, // Rafraîchit toutes les 60 secondes
      maxConcurrent: 5, // Nombre maximum de requêtes simultanées
      minTime: 0, // Temps minimum entre les requêtes
    });

    this.retryOptions = {
      retries: 3, // Nombre de retries
      initialDelay: 1000, // Délai initial de 1 seconde
      backoffFactor: 2, // Facteur de backoff exponentiel
    };
  }

  async enqueue(requestConfig) {
    const task = async () => {
      let retries = this.retryOptions.retries;
      let delay = this.retryOptions.initialDelay;

      while (true) {
        try {
          const response = await axios(requestConfig);
          return response;
        } catch (error) {
          retries -= 1;
          if (retries <= 0) {
            throw error;
          }
          if (this.isRetryableError(error)) {
            console.warn(`Request failed: ${error.message}. Retrying in ${delay}ms...`);
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
      return !error.response || error.response.status >= 500;
    } else {
      // Pour d'autres types d'erreurs
      return true; // Vous pouvez affiner cette logique selon vos besoins
    }
  }
}

module.exports = new DexScreenerRateLimiter(60); // Ajustez le nombre selon votre limite

