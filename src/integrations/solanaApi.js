const { Connection, PublicKey } = require('@solana/web3.js');
const config = require('../utils/config');
const HeliusRateLimiter = require('../utils/rateLimiters/heliusRateLimiter');
const ApiCallCounter = require('../utils/ApiCallCounter');
const BigNumber = require('bignumber.js');

class SolanaApi {
  constructor() {
    if (!config.HELIUS_RPC_URL) {
      throw new Error('HELIUS_RPC_URL is not set. Please check your environment variables.');
    }
    this.heliusUrl = config.HELIUS_RPC_URL;
    this.connection = new Connection(this.heliusUrl, 'confirmed');
  }

  async callHelius(method, params, apiType = 'rpc', mainContext = 'default', subContext = null) {
    try {
      ApiCallCounter.incrementCall('Helius', method, mainContext, subContext);
      const response = await HeliusRateLimiter.rateLimitedAxios({
        method: 'post',
        url: this.heliusUrl,
        data: {
          jsonrpc: '2.0',
          id: 'helius-call',
          method: method,
          params: params
        },
        timeout: 30000
      }, apiType);

      if (!response.data || !response.data.result) {
        console.error(`Unexpected response structure from Helius for method ${method}:`, response.data);
        return null;
      }
      return response.data.result;
    } catch (error) {
      console.error(`Error calling Helius method ${method}:`, error);
      throw error;
    }
  }

  async getAssetsByOwner(ownerAddress, page = 1, limit = 1000, showFungible = true, mainContext = 'default', subContext = null) {
    const result = await this.callHelius('getAssetsByOwner', {
      ownerAddress,
      page,
      limit,
      displayOptions: { showFungible }
    },'api', mainContext, subContext);
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

  async getAsset(tokenAddress, mainContext = 'default', subContext = null) {
    try {
      const result = await this.callHelius('getAsset', {
        id: tokenAddress,
        displayOptions: {
          showFungible: true
        }
      }, 'api', mainContext, subContext);
  
      if (!result || !result.token_info) {
        console.error(`No asset info found for token ${tokenAddress}`);
        return null;
      }
  
      // Ajuster la supply en tenant compte des décimales
      const rawSupply = new BigNumber(result.token_info.supply || 0);
      const decimals = result.token_info.decimals || 0;
      const adjustedSupply = rawSupply.dividedBy(new BigNumber(10).pow(decimals));
  
      return {
        address: tokenAddress,
        decimals: result.token_info.decimals || 0,
        symbol: result.token_info.symbol || result.content?.metadata?.symbol || 'Unknown',
        name: result.content?.metadata?.name || 'Unknown Token',
        supply: {
          total: adjustedSupply
        },
        price: result.token_info.price_info?.price_per_token || 0
      };
    } catch (error) {
      console.error(`Error fetching asset info for ${tokenAddress}:`, error);
      return null;
    }
  }

  async getTokenAccounts(mint, limit = 1000, cursor, mainContext = 'default', subContext = null) {
    let params = { limit, mint };
    if (cursor) {
      params.cursor = cursor;
    }
    try {
      const response = await this.callHelius('getTokenAccounts', params, 'api',  mainContext, subContext);
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

  async getTokenAccountBalance(tokenAccountAddress, config = {}, mainContext = 'default', subContext = null) {
    try {
      // Assurez-vous que le champ 'commitment' est présent dans config
      if (!config.commitment) {
        config.commitment = 'confirmed';
      }
  
      const result = await this.callHelius('getTokenAccountBalance', [tokenAccountAddress, config], 'rpc', mainContext, subContext);
      
      if (!result || !result.value) {
        console.error(`Unexpected result for getTokenAccountBalance of account ${tokenAccountAddress}:`, result);
        return null;
      }
  
      return {
        amount: result.value.amount,
        decimals: result.value.decimals,
        uiAmount: result.value.uiAmount,
        uiAmountString: result.value.uiAmountString
      };
    } catch (error) {
      console.error(`Error getting token account balance for ${tokenAccountAddress}:`, error);
      throw error;
    }
  }

  async getTokenAccountsByOwner(walletAddress, tokenAddress, mainContext = 'default', subContext = null) {
    // Validation des paramètres
    if (!walletAddress || !tokenAddress) {
        console.error('Missing required parameters in getTokenAccountsByOwner:', { walletAddress, tokenAddress });
        return [];
    }

    // S'assurer que walletAddress est une chaîne de caractères valide
    const validWalletAddress = typeof walletAddress === 'string' 
        ? walletAddress 
        : walletAddress?.address || null;

    if (!validWalletAddress) {
        console.error('Invalid wallet address format:', walletAddress);
        return [];
    }
    
    const validTokenAddress = typeof tokenAddress === 'string' 
        ? tokenAddress 
        : tokenAddress?.address || null;

    if (!validTokenAddress) {
        console.error('Invalid token address format:', tokenAddress);
        return [];
    }

    try {
        const result = await this.callHelius('getTokenAccountsByOwner', [
            validWalletAddress,
            { mint: validTokenAddress },
            { encoding: 'jsonParsed' }
        ], 'rpc', mainContext, subContext);

        if (!result || !Array.isArray(result.value)) {
            console.error(`Unexpected result structure from Helius for method getTokenAccountsByOwner:`, result);
            return [];
        }

        return result.value;
    } catch (error) {
        console.error(`Error in getTokenAccountsByOwner for wallet ${validWalletAddress}:`, error);
        return [];
    }
}

  async getTokenLargestAccounts(tokenMint, mainContext = 'default', subContext = null) {
    const response = await this.callHelius('getTokenLargestAccounts', [tokenMint], 'rpc', mainContext, subContext);
    if (!response || !Array.isArray(response.value)) {
      console.error(`Invalid response for getTokenLargestAccounts of token: ${tokenMint}`, response);
      return { value: [] };
    }
    return response;
  }

  async getSignaturesForAddress(address, options = { limit: 1000 }, mainContext = 'default', subContext = null) {
    const result = await this.callHelius('getSignaturesForAddress', [address, options], 'rpc', mainContext, subContext);
    if (!Array.isArray(result)) {
      console.error(`Unexpected result for getSignaturesForAddress of address ${address}:`, result);
      return [];
    }
    return result;
  }

  async getTransaction(signature, options = { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }, mainContext = 'default', subContext = null) {
    const result = await this.callHelius('getTransaction', [signature, options], 'rpc', mainContext, subContext);
    if (!result) {
      console.error(`No transaction details found for signature ${signature}`);
      return null;
    }
    return result;
  }
  
  async getBalance(address, mainContext = 'default', subContext = null) {
    const result = await this.callHelius('getBalance', [address], 'rpc', mainContext, subContext);
    if (result === null || result.value === undefined) {
      console.error(`Unexpected result for getBalance of address ${address}:`, result);
      return null;
    }
    return result;
  }

  async getTokenMetadata(tokenAddress, mainContext = 'default', subContext = null) {
    try {
      const accountInfo = await this.getAccountInfo(tokenAddress, { encoding: 'jsonParsed' }, mainContext, subContext);
      if (!accountInfo?.value?.data?.parsed?.info) {
        console.error(`No metadata found for token ${tokenAddress}`);
        return null;
      }
  
      const mintInfo = accountInfo.value.data.parsed.info;
  
      const supplyInfo = await this.getTokenSupply(tokenAddress, mainContext, subContext);
  
      return {
        address: tokenAddress,
        decimals: mintInfo.decimals,
        supply: {
          total: supplyInfo?.value?.uiAmount || 0
        },
        symbol: mintInfo.symbol || 'Unknown',
      };
    } catch (error) {
      console.error(`Error fetching token metadata for ${tokenAddress}:`, error);
      return null;
    }
  }

  async getTokenSupply(tokenAddress, mainContext = 'default', subContext = null) {
    const result = await this.callHelius('getTokenSupply', [tokenAddress], 'rpc', mainContext, subContext);
    if (!result || result.value === undefined) {
      console.error(`Unexpected result for getTokenSupply of token ${tokenAddress}:`, result);
      return null;
    }
    return result;
  }

  async getAccountInfo(address, config = { encoding: 'jsonParsed' }, mainContext = 'default', subContext = null) {
    const response = await this.callHelius('getAccountInfo', [address, config], 'rpc', mainContext, subContext);
    if (!response || response.value === undefined) {
      console.error(`Invalid response for getAccountInfo of address: ${address}`, response);
      return null;
    }
    return response;
  }
}

const getSolanaApi = () => new SolanaApi();

module.exports = { getSolanaApi };