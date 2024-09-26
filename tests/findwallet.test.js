const axios = require('axios');
const BigNumber = require('bignumber.js');

// Configuration
const HELIUS_API_KEY="17c9f1f1-12e3-41e9-9d15-6143ad66e393"; // Remplacez par votre clé API Helius
const HELIUS_RPC_URL = `https://rpc.helius.xyz/?api-key=${HELIUS_API_KEY}`;
const MIN_TOKEN_THRESHOLD = 0; // Pas de seuil minimum si vous voulez tous les détenteurs


// Liste des adresses partielles
const partialAddresses = [
    { firstSix: 'C2n9iE', lastFive: 'RF47c' },
    { firstSix: 'EGcrxQ', lastFive: 'iogDh' },
    { firstSix: '4Be9Cv', lastFive: '3ha7t' },
    { firstSix: 'HYWo71', lastFive: 'Q1ENp' },
    { firstSix: '2etgHx', lastFive: 'HGxtV' },
    { firstSix: '3pVNqL', lastFive: 'jbtLD' },
  ];
  
  // Fonction pour gérer le taux limite des requêtes
  const queue = [];
  const RATE_LIMIT = 3; // requêtes par seconde
  const INTERVAL = 1000; // 1 seconde
  
  const enqueue = (fn) => {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
    });
  };
  
  setInterval(() => {
    const requests = queue.splice(0, RATE_LIMIT);
    requests.forEach(({ fn, resolve, reject }) => {
      fn().then(resolve).catch(reject);
    });
  }, INTERVAL);
  
  const rateLimitedAxios = (config) => {
    return enqueue(() => axios(config));
  };
  
  // Fonction pour récupérer les détenteurs du token
  async function getHolders(coinAddress) {
    try {
      let matchingAccounts = new Set();
      let cursor;
  
      while (true) {
        let params = {
          limit: 1000,
          mint: coinAddress,
        };
  
        if (cursor !== undefined) {
          params.cursor = cursor;
        }
  
        const response = await rateLimitedAxios({
          method: 'post',
          url: HELIUS_RPC_URL,
          headers: {
            'Content-Type': 'application/json',
          },
          data: {
            jsonrpc: '2.0',
            id: 'helius-test',
            method: 'getTokenAccounts',
            params: params,
          },
        });
  
        const data = response.data;
  
        // Vérifier s'il y a une erreur dans la réponse
        if (data.error) {
          console.error('Erreur de l\'API :', data.error);
          break;
        }
  
        // Utilisez la propriété correcte 'token_accounts' au lieu de 'tokenAccounts'
        if (!data.result || data.result.token_accounts.length === 0) {
          console.log('No more results');
          break;
        }
  
        data.result.token_accounts.forEach((account) => {
          const ownerAddress = account.owner;
  
          // Vérifier si l'adresse correspond à l'une des adresses partielles
          for (const partial of partialAddresses) {
            if (
              ownerAddress.startsWith(partial.firstSix) &&
              ownerAddress.endsWith(partial.lastFive)
            ) {
              matchingAccounts.add(ownerAddress);
              console.log(`Correspondance trouvée: ${ownerAddress}`);
              break; // Si une correspondance est trouvée, on sort de la boucle
            }
          }
        });
  
        console.log(`Total des adresses correspondantes jusqu'à présent : ${matchingAccounts.size}`);
  
        cursor = data.result.cursor;
  
        if (!cursor) {
          console.log('Arrêt de la pagination : plus de curseur');
          break;
        }
      }
  
      console.log(`Total des adresses correspondantes : ${matchingAccounts.size}`);
  
      return Array.from(matchingAccounts);
    } catch (error) {
      console.error('Erreur lors de la récupération des détenteurs:', error);
      throw error;
    }
  }
  
  // Exécution principale
  (async () => {
    const coinAddress = 'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY'; // Remplacez par l'adresse complète du token
    const matchingHolders = await getHolders(coinAddress);
  
    console.log('Adresses correspondantes :', matchingHolders);
  })();