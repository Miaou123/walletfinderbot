const Bottleneck = require('bottleneck');
const axios = require('axios');

class DexScreenerRateLimiter {
 constructor() {
   this.limiter = new Bottleneck({
     reservoir: 300,
     reservoirRefreshAmount: 300,
     reservoirRefreshInterval: 60000,
     maxConcurrent: 20,
     minTime: 0
   });

   this.retryOptions = {
     retries: 3,
     initialDelay: 1000,
     backoffFactor: 2
   };
 }

 async enqueue(requestConfig) {
   const task = async () => {
     let retries = this.retryOptions.retries;
     let delay = this.retryOptions.initialDelay;

     while (true) {
       try {
         return await axios(requestConfig);
       } catch (error) {
         if (--retries <= 0 || !this.isRetryableError(error)) throw error;
         
         console.warn(`Request failed: ${error.message}. Retrying in ${delay}ms...`);
         await new Promise(resolve => setTimeout(resolve, delay));
         delay *= this.retryOptions.backoffFactor;
       }
     }
   };

   return this.limiter.schedule(() => task());
 }

 isRetryableError(error) {
   return error.isAxiosError ? (!error.response || error.response.status >= 500) : true;
 }
}

module.exports = new DexScreenerRateLimiter();