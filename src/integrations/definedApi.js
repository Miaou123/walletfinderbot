const axios = require('axios');
const ApiCallCounter = require('../utils/ApiCallCounter');
const definedRateLimiter = require('../utils/rateLimiters/definedRateLimiter');

class DefinedApi {
    constructor() {
        this.baseUrl = 'https://graph.defined.fi/graphql'; // URL de base générique de l'API
        this.apiKey = process.env.DEFINED_API_KEY; // Assurez-vous que votre clé API est définie
        this.solanaNetworkId = 1399811149;
    }

    async fetchData(query, variables, methodName, mainContext = 'default', subContext = null) {
        ApiCallCounter.incrementCall('Defined', methodName, mainContext, subContext);
    
        const requestFunction = async () => {
            try {
                console.log(`Envoi de la requête à l'API Defined (${methodName}):`, JSON.stringify({ query, variables }, null, 2));
                const response = await axios.post(this.baseUrl, { query, variables }, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': this.apiKey, // Pas de 'Bearer' ici
                    },
                });
                console.log('Réponse reçue:', JSON.stringify(response.data, null, 2));
                if (response.data.errors) {
                    throw new Error(JSON.stringify(response.data.errors));
                }
                return response.data;
            } catch (error) {
                console.error(`Erreur lors de l'appel à l'API Defined (${methodName}):`, error.message);
                if (error.response) {
                    console.error('Données de réponse:', error.response.data);
                    console.error('Statut de réponse:', error.response.status);
                    console.error('En-têtes de réponse:', error.response.headers);
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
    
        console.log('Variables getTokenEvents:', JSON.stringify(variables, null, 2));
    
        return this.fetchData(query, variables, 'getTokenEvents', mainContext, subContext);
    }    

}

module.exports = new DefinedApi();
