/**
 * addressCategorization.js
 * Centralized utility for categorizing and identifying known addresses
 */

const logger = require('./logger');

/**
 * Address categories for organization
 */
const ADDRESS_CATEGORIES = {
  EXCHANGE: 'Exchange',
  DEX: 'DEX',
  BRIDGE: 'Bridge',
  PROTOCOL: 'Protocol',
  DAO: 'DAO',
  TEAM: 'Team',
  BOT: 'Bot',
  WHALE: 'Whale',
  INFLUENCER: 'Influencer',
  DEPLOYER: 'Deployer'
};

/**
 * Comprehensive mapping of known addresses
 * Format: 'address': { name: 'User-friendly name', category: 'Category' }
 */
const KNOWN_ADDRESSES = {
  // Major Exchanges - CEX
  "H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS": { name: "Coinbase", category: ADDRESS_CATEGORIES.EXCHANGE },
  "2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm": { name: "Coinbase 2", category: ADDRESS_CATEGORIES.EXCHANGE },
  "GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE": { name: "Coinbase Hot Wallet", category: ADDRESS_CATEGORIES.EXCHANGE },
  "FpwQQhQQoEaVu3WU2qZMfF1hx48YyfwsLoRgXG83E99Q": { name: "Coinbase Hot Wallet 2", category: ADDRESS_CATEGORIES.EXCHANGE },
  "FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5": { name: "Kraken", category: ADDRESS_CATEGORIES.EXCHANGE },
  "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9": { name: "Binance", category: ADDRESS_CATEGORIES.EXCHANGE },
  "5sTQ5ih7xtctBhMXHr3f1aWdaXazWrWfoehqWdqWnTFP": { name: "Wintermute 3", category: ADDRESS_CATEGORIES.EXCHANGE },
  "AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2": { name: "Bybit", category: ADDRESS_CATEGORIES.EXCHANGE },
  "u6PJ8DtQuPFnfmwHbGFULQ4u4EgjDiyYKjVEsynXq2w": { name: "Gate.io", category: ADDRESS_CATEGORIES.EXCHANGE },
  "5VCwKtCXgCJ6kit5FybXjvriW3xELsFDhYrPSqtJNmcD": { name: "OKX", category: ADDRESS_CATEGORIES.EXCHANGE },
  "Biw4eeaiYYYq6xSqEd7GzdwsrrndxA8mqdxfAtG3PTUU": { name: "Revolut", category: ADDRESS_CATEGORIES.EXCHANGE },
  "BmFdpraQhkiDQE6SnfG5omcA1VwzqfXrwtNYBwWTymy6": { name: "Kucoin", category: ADDRESS_CATEGORIES.EXCHANGE },
  "HVh6wHNBAsG3pq1Bj5oCzRjoWKVogEDHwUHkRz3ekFgt": { name: "Kucoin", category: ADDRESS_CATEGORIES.EXCHANGE },
  
  // DEXes and Liquidity Pools
  "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1": { name: "Raydium", category: ADDRESS_CATEGORIES.DEX },
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": { name: "Raydium 2", category: ADDRESS_CATEGORIES.DEX },
  "GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL": { name: "Raydium 3", category: ADDRESS_CATEGORIES.DEX },
  "MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG": { name: "Moonshot", category: ADDRESS_CATEGORIES.DEX },
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo": { name: "Meteora", category: ADDRESS_CATEGORIES.DEX },
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P": { name: "Pump.fun", category: ADDRESS_CATEGORIES.DEX },
  "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C": { name: "Orca", category: ADDRESS_CATEGORIES.DEX },
  "G2YxRa6wt1qePMwfJzdXZG62ej4qaTC7YURzuh2Lwd3t": { name: "Jupiter", category: ADDRESS_CATEGORIES.DEX },
  
  // Bridges and Cross-Chain Infrastructure
  "GugU1tP7doLeTw9hQP51xRJyS8Da1fWxuiy2rVrnMD2m": { name: "Wormhole 2", category: ADDRESS_CATEGORIES.BRIDGE },


};

/**
 * Get information about a known address
 * @param {string} address - The address to look up
 * @returns {Object|null} Information about the address or null if not found
 */
function getAddressInfo(address) {
  if (!address) return null;
  return KNOWN_ADDRESSES[address] || null;
}

/**
 * Get the user-friendly name for an address
 * @param {string} address - The address to look up
 * @returns {string|null} The name or null if not a known address
 */
function getAddressName(address) {
  const info = getAddressInfo(address);
  return info ? info.name : null;
}

/**
 * Get the category for an address
 * @param {string} address - The address to look up
 * @returns {string|null} The category or null if not a known address
 */
function getAddressCategory(address) {
  const info = getAddressInfo(address);
  return info ? info.category : null;
}

/**
 * Check if an address belongs to a specific category
 * @param {string} address - The address to check
 * @param {string} category - The category to check for
 * @returns {boolean} True if the address belongs to the category
 */
function isAddressInCategory(address, category) {
  const info = getAddressInfo(address);
  return info ? info.category === category : false;
}

/**
 * Check if an address is a known exchange
 * @param {string} address - The address to check
 * @returns {boolean} True if the address is a known exchange
 */
function isExchange(address) {
  return isAddressInCategory(address, ADDRESS_CATEGORIES.EXCHANGE);
}

/**
 * Check if an address is a known DEX
 * @param {string} address - The address to check
 * @returns {boolean} True if the address is a known DEX
 */
function isDEX(address) {
  return isAddressInCategory(address, ADDRESS_CATEGORIES.DEX);
}

/**
 * Add a new known address to the runtime (not persisted)
 * @param {string} address - The address to add
 * @param {string} name - User-friendly name
 * @param {string} category - Address category
 * @returns {boolean} True if added successfully
 */
function addKnownAddress(address, name, category) {
  try {
    if (!address || !name || !category) {
      logger.warn('Invalid parameters for addKnownAddress');
      return false;
    }
    
    if (!Object.values(ADDRESS_CATEGORIES).includes(category)) {
      logger.warn(`Invalid category: ${category}`);
      return false;
    }
    
    KNOWN_ADDRESSES[address] = { name, category };
    return true;
  } catch (error) {
    logger.error('Error adding known address:', error);
    return false;
  }
}

/**
 * Get all addresses in a specific category
 * @param {string} category - The category to filter by
 * @returns {Array} Array of addresses in the category
 */
function getAddressesByCategory(category) {
  return Object.entries(KNOWN_ADDRESSES)
    .filter(([_, info]) => info.category === category)
    .map(([address, _]) => address);
}

module.exports = {
  ADDRESS_CATEGORIES,
  KNOWN_ADDRESSES,
  getAddressInfo,
  getAddressName,
  getAddressCategory,
  isAddressInCategory,
  isExchange,
  isDEX,
  addKnownAddress,
  getAddressesByCategory
};