const { Connection, PublicKey  } = require('@solana/web3.js');
const config = require('../utils/config');
const { rateLimitedAxios } = require('../utils/rateLimiter');

class SolanaApi {

  constructor() {
    if (!config.HELIUS_RPC_URL) {
      throw new Error('HELIUS_RPC_URL is not set. Please check your environment variables.');
    }
    this.heliusUrl = config.HELIUS_RPC_URL;
    this.connection = new Connection(this.heliusUrl, 'confirmed');
  }

  async callHeliusApi(method, params) {
    try {
      const response = await rateLimitedAxios({
        method: 'post',
        url: this.heliusUrl,
        data: {
          jsonrpc: '2.0',
          id: 'helius-api-call',
          method: method,
          params: params
        }
      }, true);
      return response.data.result;
    } catch (error) {
      console.error(`Error calling Helius API method ${method}:`, error);
      throw error;
    }
  }

  async getAssetsByOwner(ownerAddress, page, limit) {
    return this.callHeliusApi('getAssetsByOwner', {
      ownerAddress,
      page,
      limit,
      displayOptions: { showFungible: true }
    });
  }

  async getBalance(address) {
    const result = await this.callHeliusApi('getBalance', [address]);
    return result.value;
  }

  async getTokenDecimals(tokenAddress) {
    try {
      const tokenPublicKey = new PublicKey(tokenAddress);
      const accountInfo = await this.connection.getAccountInfo(tokenPublicKey);
      if (accountInfo === null) {
        throw new Error('Token account not found');
      }
      const data = Buffer.from(accountInfo.data);
      return data[44];
    } catch (error) {
      console.error('Error getting token decimals:', error);
      return 9;
    }
  }

  async getAssetsByOwner(ownerAddress, page, limit) {
    return this.callHeliusApi('getAssetsByOwner', {
      ownerAddress,
      page,
      limit,
      displayOptions: { showFungible: true }
    });
  }

  async getBalance(address) {
    const result = await this.callHeliusApi('getBalance', [address]);
    return result.value;
  }

  async getTokenDecimals(tokenAddress) {
    try {
      const tokenPublicKey = new PublicKey(tokenAddress);
      const accountInfo = await this.connection.getAccountInfo(tokenPublicKey);
      if (accountInfo === null) {
        throw new Error('Token account not found');
      }
      const data = Buffer.from(accountInfo.data);
      return data[44];
    } catch (error) {
      console.error('Error getting token decimals:', error);
      return 9;
    }
  }

  async getTokenAccounts(mint, limit = 1000, cursor) {
    let params = { limit, mint };
    if (cursor) {
      params.cursor = cursor;
    }
    return this.callHeliusApi('getTokenAccounts', params);
  }

  async getTokenLargestAccounts(mint) {
    return this.callHeliusApi('getTokenLargestAccounts', [mint]);
  }

  async getAccountInfo(address, config = {encoding: 'jsonParsed'}) {
    return this.callHeliusApi('getAccountInfo', [address, config]);
  }

  async getSignaturesForAddress(address, options = { limit: 1000 }) {
    return this.callHeliusApi('getSignaturesForAddress', [address, options]);
  }

  async getTransaction(signature, options = { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }) {
    return this.callHeliusApi('getTransaction', [signature, options]);
  }

  async getWalletInfo(walletAddress) {
    try {
      const result = await this.callHeliusApi('getBalance', [walletAddress]);
      const balance = result.value / 1e9;

      return {
        address: walletAddress,
        solanaBalance: balance,
      };
    } catch (error) {
      console.error('Error fetching wallet info:', error);
      throw error;
    }
  }
}

const getSolanaApi = () => new SolanaApi();

module.exports = { getSolanaApi };