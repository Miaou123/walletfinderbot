const Bottleneck = require('bottleneck');
const axios = require('axios');

class HeliusRateLimiter {
  constructor() {
    // Limiteur pour les appels RPC
    this.rpcLimiter = new Bottleneck({
      reservoir: 50, // Nombre de requêtes par seconde pour RPC
      reservoirRefreshAmount: 50,
      reservoirRefreshInterval: 1000, // Rafraîchit chaque seconde
      maxConcurrent: 5, // Nombre maximum de requêtes simultanées
      minTime: 0, // Temps minimum entre les requêtes
    });

    // Limiteur pour les appels API
    this.apiLimiter = new Bottleneck({
      reservoir: 10, // Nombre de requêtes par seconde pour API
      reservoirRefreshAmount: 10,
      reservoirRefreshInterval: 1000,
      maxConcurrent: 5,
      minTime: 0,
    });

    this.retryOptions = {
      retries: 3, // Nombre de retries
      initialDelay: 1000, // Délai initial en ms
      backoffFactor: 2, // Facteur de backoff exponentiel
    };
  }

  async rateLimitedAxios(requestConfig, apiType) {
    const limiter = apiType === 'api' ? this.apiLimiter : this.rpcLimiter;

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

    return limiter.schedule(() => task());
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

module.exports = new HeliusRateLimiter();
