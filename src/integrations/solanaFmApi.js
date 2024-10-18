const axios = require('axios');
const UserAgent = require('user-agents');
const ApiCallCounter = require('../utils/ApiCallCounter');
const solanaFmRateLimiter = require('../utils/rateLimiters/solanaFmRateLimiter');
const logger = require('../utils/logger');

class SolanaFmApi {
    constructor() {
        this.baseUrl = 'https://api.solana.fm/v0';
    }

    async fetchData(endpoint, method, mainContext = 'default', subContext = null) {
        ApiCallCounter.incrementCall('SolanaFm', method, mainContext, subContext);

        const requestFunction = async () => {
            const userAgent = new UserAgent();
            try {
                const response = await axios.get(`${this.baseUrl}${endpoint}`, {
                    headers: {
                        'User-Agent': userAgent.toString(),
                        'Accept': 'application/json',
                    },
                    timeout: 30000,
                });
                return response.data;
            } catch (error) {
                logger.error(`Error fetching data from Solana.fm: ${error.message}`);
                throw error;
            }
        };

        return solanaFmRateLimiter.enqueue(requestFunction);
    }

    async getTransfers(txHash, mainContext = 'default', subContext = null) {
        return this.fetchData(`/transfers/${txHash}`, 'getTransfers', mainContext, subContext);
    }
}

module.exports = new SolanaFmApi();