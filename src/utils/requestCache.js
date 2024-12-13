const logger = require('../utils/logger');

class RequestCache {
    constructor(defaultTTL = 5 * 60 * 1000) { // 5 minutes par défaut
        this.cache = new Map();
        this.defaultTTL = defaultTTL;
    }

    set(key, value, ttl = this.defaultTTL) {
        const expirationTime = Date.now() + ttl;
        this.cache.set(key, {
            value,
            expirationTime
        });
        
        // Planifier le nettoyage automatique
        setTimeout(() => {
            this.cache.delete(key);
        }, ttl);
    }

    get(key) {
        const cached = this.cache.get(key);
        if (!cached) {
            return null;
        }

        if (Date.now() > cached.expirationTime) {
            this.cache.delete(key);
            return null;
        }

        return cached.value;
    }

    clear() {
        this.cache.clear();
    }

    getSize() {
        return this.cache.size;
    }

    // Utilitaire pour générer une clé basée sur la commande et ses paramètres
    static generateKey(command, params) {
        return `${command}:${JSON.stringify(params)}`;
    }
}

// Exemple d'utilisation
async function cachedCommand(cache, command, params, fetchFunction) {
    const cacheKey = RequestCache.generateKey(command, params);
    
    // Vérifier le cache
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
        logger.debug(`Cache hit for ${cacheKey}`);
        return cachedResult;
    }

    // Exécuter la commande si pas en cache
    logger.debug(`Cache miss for ${cacheKey}, fetching data`);
    const result = await fetchFunction();
    
    // Mettre en cache le résultat
    cache.set(cacheKey, result);
    
    return result;
}

module.exports = { RequestCache, cachedCommand };