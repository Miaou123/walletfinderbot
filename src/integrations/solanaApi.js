const { Connection, PublicKey } = require('@solana/web3.js');
const config = require('../utils/config');
const HeliusRateLimiter = require('../utils/rateLimiters/heliusRateLimiter');
const ApiCallCounter = require('../utils/ApiCallCounter');
const BigNumber = require('bignumber.js');
const logger = require('../utils/logger');

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
  
      // Si le rate limiter renvoie null, loguer plus de détails
      if (!response) {
        console.error(`[Helius Debug] Null response from rate limiter for ${method}:`, {
          method,
          params,
          mainContext,
          subContext
        });
        return null;
      }
  
      if (!response.data) {
        console.error(`[Helius Debug] Empty response data for ${method}:`, {
          method,
          params,
          response: response
        });
        return null;
      }
  
      // Log les erreurs RPC spécifiques
      if (response.data.error) {
        console.error(`[Helius RPC Error] ${method}:`, {
          error: response.data.error,
          request: {
            method,
            params,
            mainContext,
            subContext
          }
        });
        return null;
      }
  
      if (response.data.result === undefined) {
        console.error(`[Helius Debug] Missing result in response for ${method}:`, {
          method,
          params,
          responseData: response.data
        });
        return null;
      }
  
      return response.data.result;
    } catch (error) {
      // Log détaillé de l'erreur
      console.error(`[Helius Error] ${method}:`, {
        error: {
          name: error.name,
          message: error.message,
          code: error.code,
          response: error.response?.data,
          status: error.response?.status,
          headers: error.response?.headers
        },
        request: {
          method,
          params,
          mainContext,
          subContext
        }
      });
      return null;
    }
  }

  async getAssetsByOwner(ownerAddress, limit = 1000, options = {}, mainContext = 'default', subContext = null) {
    const result = await this.callHelius('getAssetsByOwner', {
      ownerAddress,
      limit,
      after: options.after || null,
      displayOptions: {
        showFungible: options.showFungible || false,
        showNativeBalance: options.showNativeBalance || false,
        showZeroBalance: options.showZeroBalance || false
      }
    }, 'api', mainContext, subContext);
  
    if (!result || !Array.isArray(result.items)) {
      return { items: [], total: 0, nativeBalance: 0 };
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

        if (!result?.token_info) {
            logger.error(`Invalid result for token ${tokenAddress}`);
            return null;
        }

        let adjustedSupply;
        try {
            const rawSupply = new BigNumber(result.token_info.supply || 0);
            const decimals = parseInt(result.token_info.decimals) || 0;
            
            if (isNaN(decimals) || decimals < 0) {
                throw new Error(`Invalid decimals value: ${decimals}`);
            }
            
            adjustedSupply = rawSupply.dividedBy(new BigNumber(10).pow(decimals));
            
            if (!adjustedSupply.isFinite()) {
                throw new Error('Supply calculation resulted in non-finite value');
            }
        } catch (error) {
            logger.error(`Error calculating supply for ${tokenAddress}:`, error);
            adjustedSupply = new BigNumber(0);
        }

        const tokenData = {
            address: tokenAddress,
            decimals: parseInt(result.token_info.decimals) || 0,
            symbol: result.token_info.symbol || result.content?.metadata?.symbol || 'Unknown',
            name: result.content?.metadata?.name || 'Unknown Token',
            supply: {
                total: adjustedSupply.toString()
            },
            price: parseFloat(result.token_info.price_info?.price_per_token) || 0
        };

        return tokenData;

        } catch (error) {
            logger.error(`Error fetching asset info for ${tokenAddress}:`, error);
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
        // Use jsonParsed encoding to get balance information directly
        const result = await this.callHelius('getTokenAccountsByOwner', [
            validWalletAddress,
            { mint: validTokenAddress },
            { encoding: 'jsonParsed', commitment: 'confirmed' }
        ], 'rpc', mainContext, subContext);

        if (!result || !Array.isArray(result.value)) {
            console.error(`Unexpected result structure from Helius for method getTokenAccountsByOwner:`, result);
            return [];
        }

        // Enhance the response with token amount info to save additional API calls
        const enhancedAccounts = result.value.map(account => {
            // Extract token amount directly from the parsed data
            const tokenAmount = account.account?.data?.parsed?.info?.tokenAmount || null;
            return {
                ...account,
                tokenAmount // Include token amount directly
            };
        });

        return enhancedAccounts;
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

  async getSignaturesForAddress(address, options = {}, mainContext = 'default', subContext = null) {
    const DEFAULT_CHUNK_SIZE = 1000;
    const maxLimit = options.limit || 1000;
    const timeout = options.timeout || 15000;
    const maxRetries = 3;
    const startTime = Date.now();

    const makeRequest = async (requestParams) => {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const result = await this.callHelius(
                'getSignaturesForAddress',
                [address, requestParams],
                'rpc',
                mainContext,
                subContext,
                15000
            );

            // Si on a un résultat valide
            if (result && Array.isArray(result)) {
                return result;
            }

            // Gestion des erreurs spécifiques
            if (result?.error?.code === -32019) {
                logger.warn(`Long-term storage error for ${address}`);
                return [];
            }

            // Si on a une réponse null ou une erreur, on retry
            if (attempt < maxRetries - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
                logger.debug(`Retrying getSignaturesForAddress for ${address} (${attempt + 2}/${maxRetries})`);
            }
        }
        return [];
      };

      try {
          // Pour les petites limites, une seule requête
          if (maxLimit <= DEFAULT_CHUNK_SIZE) {
              return await makeRequest({
                  limit: maxLimit,
                  ...options.commitment && { commitment: options.commitment },
                  ...options.until && { until: options.until }
              });
          }

          // Pour les grandes limites, pagination avec retries
          let signatures = [];
          let lastSignature = undefined;

          while (signatures.length < maxLimit) {
              if (Date.now() - startTime > timeout) {
                  logger.warn(`Timeout reached for ${address}, returning ${signatures.length} signatures`);
                  break;
              }

              const chunk = await makeRequest({
                  limit: Math.min(DEFAULT_CHUNK_SIZE, maxLimit - signatures.length),
                  ...options.commitment && { commitment: options.commitment },
                  ...options.until && { until: options.until },
                  ...lastSignature && { before: lastSignature }
              });

              if (!chunk.length) break;

              signatures = [...signatures, ...chunk];
              lastSignature = chunk[chunk.length - 1].signature;
          }

          return signatures;

      } catch (error) {
          logger.error(`Error in getSignaturesForAddress for ${address}:`, {
              error: error.message,
              signatures: signatures?.length || 0,
              elapsed: Date.now() - startTime
          });
          return [];
      }
  }

  async getTransaction(signature, options = { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }, mainContext = 'default', subContext = null) {
    try {
      const result = await this.callHelius('getTransaction', [signature, options], 'rpc', mainContext, subContext);
      if (!result) {
        console.error(`No transaction details found for signature ${signature} in context ${mainContext}/${subContext}`);
        return null;
      }
      return result;
    } catch (error) {
      console.error(`Error in getTransaction with signature ${signature} and context ${mainContext}/${subContext}:`, error);
      throw error;
    }
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