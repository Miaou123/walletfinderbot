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

  async getAssetsByOwner(ownerAddress, limit = 100, options = {}, mainContext = 'default', subContext = null) {
    const params = {
      ownerAddress,
      limit,
      ...(options.after && { after: options.after }),
      displayOptions: {
        showFungible: options.showFungible || false,
        showNativeBalance: options.showNativeBalance || false,
        showZeroBalance: options.showZeroBalance || false
      }
    };
    
    const result = await this.callHelius('getAssetsByOwner', params, 'api', mainContext, subContext);
  
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

 // Enhanced getTokenAccountsByOwner method for SolanaApi.js
// Replace the existing method with this improved version

async getTokenAccountsByOwner(walletAddress, tokenAddress, mainContext = 'default', subContext = null) {
  // Enhanced validation
  if (!walletAddress || !tokenAddress) {
      logger.error('Missing required parameters in getTokenAccountsByOwner:', { walletAddress, tokenAddress });
      return [];
  }

  // Normalize addresses
  const validWalletAddress = typeof walletAddress === 'string' 
      ? walletAddress.trim() 
      : walletAddress?.address?.trim() || null;

  const validTokenAddress = typeof tokenAddress === 'string' 
      ? tokenAddress.trim() 
      : tokenAddress?.address?.trim() || null;

  if (!validWalletAddress || !validTokenAddress) {
      logger.error('Invalid address format:', { walletAddress: validWalletAddress, tokenAddress: validTokenAddress });
      return [];
  }

  // Add retry mechanism with exponential backoff
  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
      try {
          attempt++;
          
          // Add a small delay between retries
          if (attempt > 1) {
              const delay = Math.min(1000 * Math.pow(2, attempt - 2), 5000); // 1s, 2s, 4s max
              logger.debug(`Retrying getTokenAccountsByOwner for ${validWalletAddress}, attempt ${attempt}, delay: ${delay}ms`);
              await new Promise(resolve => setTimeout(resolve, delay));
          }

          const result = await this.callHelius('getTokenAccountsByOwner', [
              validWalletAddress,
              { mint: validTokenAddress },
              { encoding: 'jsonParsed', commitment: 'confirmed' }
          ], 'rpc', mainContext, subContext);

          // Enhanced result validation
          if (!result) {
              logger.warn(`Null result from Helius for getTokenAccountsByOwner (attempt ${attempt}/${maxRetries}):`, {
                  wallet: validWalletAddress.slice(0, 8) + '...',
                  token: validTokenAddress.slice(0, 8) + '...',
                  mainContext,
                  subContext
              });
              
              // If it's the last attempt, return empty array
              if (attempt === maxRetries) {
                  return [];
              }
              continue; // Try again
          }

          if (!Array.isArray(result.value)) {
              logger.warn(`Invalid result structure from Helius (attempt ${attempt}/${maxRetries}):`, {
                  result,
                  wallet: validWalletAddress.slice(0, 8) + '...',
                  token: validTokenAddress.slice(0, 8) + '...'
              });
              
              if (attempt === maxRetries) {
                  return [];
              }
              continue;
          }

          // Enhance the response with better error handling
          const enhancedAccounts = result.value.map(account => {
              try {
                  // Extract token amount safely
                  const tokenAmount = account.account?.data?.parsed?.info?.tokenAmount || null;
                  
                  // Validate token amount structure
                  if (tokenAmount && typeof tokenAmount.amount === 'string' && tokenAmount.decimals !== undefined) {
                      return {
                          ...account,
                          tokenAmount
                      };
                  } else {
                      logger.debug(`Invalid token amount structure for account:`, {
                          account: account.pubkey,
                          tokenAmount
                      });
                      return {
                          ...account,
                          tokenAmount: {
                              amount: '0',
                              decimals: 0,
                              uiAmount: 0,
                              uiAmountString: '0'
                          }
                      };
                  }
              } catch (accountError) {
                  logger.warn(`Error processing token account:`, {
                      account: account.pubkey,
                      error: accountError.message
                  });
                  return {
                      ...account,
                      tokenAmount: {
                          amount: '0',
                          decimals: 0,
                          uiAmount: 0,
                          uiAmountString: '0'
                      }
                  };
              }
          });

          // Success - log only on retry success or if there are results
          if (attempt > 1 || enhancedAccounts.length > 0) {
              logger.debug(`Successfully retrieved ${enhancedAccounts.length} token accounts for ${validWalletAddress.slice(0, 8)}... (attempt ${attempt})`);
          }

          return enhancedAccounts;

      } catch (error) {
          logger.warn(`Error in getTokenAccountsByOwner attempt ${attempt}/${maxRetries}:`, {
              wallet: validWalletAddress.slice(0, 8) + '...',
              token: validTokenAddress.slice(0, 8) + '...',
              error: error.message,
              mainContext,
              subContext
          });

          // If it's the last attempt, return empty array
          if (attempt === maxRetries) {
              logger.error(`All ${maxRetries} attempts failed for getTokenAccountsByOwner:`, {
                  wallet: validWalletAddress.slice(0, 8) + '...',
                  error: error.message
              });
              return [];
          }
      }
  }

  // Fallback return (should never reach here)
  return [];
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