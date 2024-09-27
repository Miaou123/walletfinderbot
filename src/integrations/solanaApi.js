const { Connection, PublicKey } = require('@solana/web3.js');
const config = require('../utils/config');
const { rateLimitedAxios } = require('../utils/rateLimiter');
const ApiCallCounter = require('../utils/ApiCallCounter');

class SolanaApi {
  constructor() {
    if (!config.HELIUS_RPC_URL) {
      throw new Error('HELIUS_RPC_URL is not set. Please check your environment variables.');
    }
    this.heliusUrl = config.HELIUS_RPC_URL;
    this.connection = new Connection(this.heliusUrl, 'confirmed');
  }

  async callHeliusApi(method, params, mainContext = 'default', subContext = null) {
    try {
      ApiCallCounter.incrementCall(method, mainContext, subContext);
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
      if (!response.data || !response.data.result) {
        console.error(`Unexpected response structure from Helius API for method ${method}:`, response.data);
        return null;
      }
      return response.data.result;
    } catch (error) {
      console.error(`Error calling Helius API method ${method}:`, error);
      throw error;
    }
  }

  async getBalance(address, mainContext = 'default', subContext = null) {
    const result = await this.callHeliusApi('getBalance', [address], mainContext, subContext);
    if (result === null || result.value === undefined) {
      console.error(`Unexpected result for getBalance of address ${address}:`, result);
      return null;
    }
    return result;
  }

  async getAssetsByOwner(ownerAddress, page = 1, limit = 1000, showFungible = true, mainContext = 'default', subContext = null) {
    const result = await this.callHeliusApi('getAssetsByOwner', {
      ownerAddress,
      page,
      limit,
      displayOptions: { showFungible }
    }, mainContext, subContext);
    if (!result || !Array.isArray(result.items)) {
      console.error(`Unexpected result structure for getAssetsByOwner of address ${ownerAddress}:`, result);
      return { items: [], total: 0 };
    }
    return result;
  }
  
  async getAssetCount(address, mainContext = 'default', subContext = null) {
    try {
      const result = await this.getAssetsByOwner(address, 1, 1, true, mainContext, subContext);
      if (result.total === undefined) {
        console.error(`Unexpected result for getAssetCount of address ${address}:`, result);
        return 0;
      }
      return result.total;
    } catch (error) {
      console.error(`Error getting asset count for ${address}:`, error.message);
      return 0;
    }
  }

  async getTokenAccounts(mint, limit = 1000, cursor, mainContext = 'default', subContext = null) {
    let params = { limit, mint };
    if (cursor) {
      params.cursor = cursor;
    }
    try {
      const response = await this.callHeliusApi('getTokenAccounts', params, mainContext, subContext);
      if (!response || !Array.isArray(response.token_accounts)) {
        console.error(`Unexpected response structure from getTokenAccounts for mint ${mint}:`, response);
        return { token_accounts: [], cursor: null };
      }
      return {
        token_accounts: response.token_accounts,
        cursor: response.cursor
      };
    } catch (error) {
      console.error(`Error fetching token accounts for ${mint}:`, error);
      return { token_accounts: [], cursor: null };
    }
  }

  async getTokenLargestAccounts(tokenMint, mainContext = 'default', subContext = null) {
    const response = await this.callHeliusApi('getTokenLargestAccounts', [tokenMint], mainContext, subContext);
    if (!response || !Array.isArray(response.value)) {
      console.error(`Invalid response for getTokenLargestAccounts of token: ${tokenMint}`, response);
      return { value: [] };
    }
    return response;
  }

  async getSignaturesForAddress(address, options = { limit: 1000 }, mainContext = 'default', subContext = null) {
    const result = await this.callHeliusApi('getSignaturesForAddress', [address, options], mainContext, subContext);
    if (!Array.isArray(result)) {
      console.error(`Unexpected result for getSignaturesForAddress of address ${address}:`, result);
      return [];
    }
    return result;
  }

  async getTransaction(signature, options = { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }, mainContext = 'default', subContext = null) {
    const result = await this.callHeliusApi('getTransaction', [signature, options], mainContext, subContext);
    if (!result) {
      console.error(`No transaction details found for signature ${signature}`);
      return null;
    }
    return result;
  }

  async getWalletInfo(walletAddress, mainContext = 'default', subContext = null) {
    const result = await this.callHeliusApi('getBalance', [walletAddress], mainContext, subContext);
    if (!result || result.value === undefined) {
      console.error(`Unexpected result for getWalletInfo of address ${walletAddress}:`, result);
      return null;
    }
    const balance = result.value / 1e9;
    return {
      address: walletAddress,
      solanaBalance: balance,
    };
  }

  async getTokenSupply(tokenAddress, mainContext = 'default', subContext = null) {
    const result = await this.callHeliusApi('getTokenSupply', [tokenAddress], mainContext, subContext);
    if (!result || result.value === undefined) {
      console.error(`Unexpected result for getTokenSupply of token ${tokenAddress}:`, result);
      return null;
    }
    return result;
  }

  async getTokenAccountsByOwner(walletAddress, tokenAddress, mainContext = 'default', subContext = null) {
    const result = await this.callHeliusApi('getTokenAccountsByOwner', [
      walletAddress,
      { mint: tokenAddress },
      { encoding: 'jsonParsed' }
    ], mainContext, subContext);
    if (!result || !Array.isArray(result.value)) {
      console.error(`Unexpected result for getTokenAccountsByOwner for wallet ${walletAddress} and token ${tokenAddress}:`, result);
      return [];
    }
    return result.value;
  }
  
  async getAccountInfo(address, config = { encoding: 'jsonParsed' }, mainContext = 'default', subContext = null) {
    const response = await this.callHeliusApi('getAccountInfo', [address, config], mainContext, subContext);
    if (!response || response.value === undefined) {
      console.error(`Invalid response for getAccountInfo of address: ${address}`, response);
      return null;
    }
    return response;
  }
}

const getSolanaApi = () => new SolanaApi();

module.exports = { getSolanaApi };