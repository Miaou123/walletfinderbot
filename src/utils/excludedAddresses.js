
const fs = require('fs').promises;
const path = require('path');
const NodeCache = require('node-cache');

const EXCLUDED_ADDRESSES = [
    '45ruCyfdRkWpRNGEqWzjCiXRHkZs8WXCLQ67Pnpye7Hp', // Jupiter Partner Referral Fee Vault
    'ZG98FUCjb8mJ824Gbs6RsgVmr1FhXb2oNiJHa2dwmPd', // bot / exchange
    'AfQ1oaudsGjvznX4JNEw671hi57JfWo4CWqhtkdgoVHU', // bot / exchange
    'GugU1tP7doLeTw9hQP51xRJyS8Da1fWxuiy2rVrnMD2m', // Wormhole Custody Authority
    'GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL', //Wormhole Custody Authority 
    '2rbMgYvzAb3xDk6vXrzKkY3VwsmyDZsJTkvB3JJYsRzA', // bot
    '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', // bot
    '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9', // Binance 2
    'AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2', //Bybit
    'u6PJ8DtQuPFnfmwHbGFULQ4u4EgjDiyYKjVEsynXq2w', //Gateio
    '5VCwKtCXgCJ6kit5FybXjvriW3xELsFDhYrPSqtJNmcD', //okx
    'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE', //coinbase
    'Biw4eeaiYYYq6xSqEd7GzdwsrrndxA8mqdxfAtG3PTUU', //exchange
    'H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS', //coinbase
    '2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm', //coinbase 2 
    '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9', //Binance 2
    '5VCwKtCXgCJ6kit5FybXjvriW3xELsFDhYrPSqtJNmcD', //OKX
    '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', //Raydium v4
    'G2YxRa6wt1qePMwfJzdXZG62ej4qaTC7YURzuh2Lwd3t', //Bridge/CEX?
    '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', //raydium
];

const JSON_PATH = path.join(__dirname, '../data/excludedAddresses.json');
const addressCache = new NodeCache({ stdTTL: 3600 }); // 1h cache

const loadExcludedAddresses = async () => {
    let cached = addressCache.get('addresses');
    if (cached) return cached;

    try {
        const data = await fs.readFile(JSON_PATH);
        const addresses = JSON.parse(data);
        addressCache.set('addresses', addresses);
        return addresses;
    } catch {
        addressCache.set('addresses', []);
        await fs.writeFile(JSON_PATH, '[]');
        return [];
    }
};

const isExcludedAddress = (address) => {
    const cached = addressCache.get('addresses') || [];
    return EXCLUDED_ADDRESSES.includes(address) || cached.includes(address);
};

const addExcludedAddress = async (address, reason = 'bot') => {
    const addresses = await loadExcludedAddresses();
    if (!addresses.includes(address)) {
        addresses.push(address);
        addressCache.set('addresses', addresses);
        await fs.writeFile(JSON_PATH, JSON.stringify(addresses));
    }
};

module.exports = {
    EXCLUDED_ADDRESSES,
  
    isExcludedAddress,
    addExcludedAddress
};