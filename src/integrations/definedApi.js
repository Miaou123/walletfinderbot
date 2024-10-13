const axios = require('axios');
const ApiCallCounter = require('../utils/ApiCallCounter');
const definedRateLimiter = require('../utils/rateLimiters/definedRateLimiter');

class DefinedApi {
    constructor() {
        this.baseUrl = 'https://graph.defined.fi/graphql';
        this.apiKey = process.env.DEFINED_API_KEY;
        this.solanaNetworkId = 1399811149;
    }

    async fetchData(query, variables, methodName, mainContext = 'default', subContext = null) {
        ApiCallCounter.incrementCall('Defined', methodName, mainContext, subContext);
    
        const requestFunction = async () => {
            try {
                const response = await axios.post(this.baseUrl, { query, variables }, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': this.apiKey,
                    },
                });
                if (response.data.errors) {
                    throw new Error(JSON.stringify(response.data.errors));
                }
                return response.data;
            } catch (error) {
                console.error(`Error calling Defined API (${methodName}):`, error.message);
                if (error.response) {
                    console.error('Response data:', error.response.data);
                    console.error('Response status:', error.response.status);
                    console.error('Response headers:', error.response.headers);
                }
                throw error;
            }
        };
    
        return definedRateLimiter.enqueue(requestFunction);
    }

    async getTokenEvents(address, fromTimestamp, toTimestamp, cursor = null, limit = 100, mainContext = 'default', subContext = null) {
        const maxAllowedLimit = 100;
        limit = Math.min(limit, maxAllowedLimit);

        const query = `
            query GetTokenEvents($cursor: String, $direction: RankingDirection, $limit: Int, $query: EventsQueryInput!) {
                getTokenEvents(cursor: $cursor, direction: $direction, limit: $limit, query: $query) {
                    cursor
                    items {
                        maker
                        transactionHash
                        timestamp
                        token0PoolValueUsd
                        token0SwapValueUsd
                        token0ValueBase
                        token1PoolValueUsd
                        token1SwapValueUsd
                        token1ValueBase
                        eventDisplayType
                    }
                }
            }
        `;
    
        const variables = {
            cursor,
            direction: "ASC",
            limit,
            query: {
                address,
                networkId: this.solanaNetworkId,
                timestamp: { from: fromTimestamp, to: toTimestamp },
                eventDisplayType: ["Buy"]
            }
        };
    
        console.log('Variables for getTokenEvents:', JSON.stringify(variables, null, 2));
    
        return this.fetchData(query, variables, 'getTokenEvents', mainContext, subContext);
    }    
}

module.exports = new DefinedApi();