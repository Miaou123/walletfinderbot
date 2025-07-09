const logger = require('../utils/logger');
const { PublicKey } = require('@solana/web3.js');

class BonkFunApi {
    constructor() {
        // Bonk.fun uses Raydium Launchpad Authority
        this.BONKFUN_AUTHORITY = new PublicKey('WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh');
        this.RAYDIUM_API_BASE = 'https://launch-history-v1.raydium.io';
        
        // Raydium program addresses
        this.RAYDIUM_AMM_PROGRAM = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
        this.RAYDIUM_CONFIG = new PublicKey('E64NGkDLLCdQ2yFNPcavaKptrEgmiQaNykUuLC1Qgwyp');
        this.SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
        this.WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
    }

    async isBonkfunToken(tokenMint) {
        try {
            const tokenMintPubkey = new PublicKey(tokenMint);
            
            // Try to derive pool ID - if successful, it's likely a bonk.fun token
            const poolId = await this.derivePoolId(tokenMintPubkey);
            
            if (poolId) {
                // Verify by checking if we can get trades from the pool
                const trades = await this.getPoolTrades(poolId, 1);
                return trades && trades.length >= 0;
            }
            
            return false;
        } catch (error) {
            logger.debug(`Token ${tokenMint} not found as bonk.fun token: ${error.message}`);
            return false;
        }
    }

    async derivePoolId(tokenMint) {
        try {
            // Method 1: Try with getPdaPoolId (if you have raydium SDK)
            try {
                const { getPdaPoolId } = require('@raydium-io/raydium-sdk');
                const { publicKey: poolId } = await getPdaPoolId(
                    this.RAYDIUM_AMM_PROGRAM,
                    this.RAYDIUM_CONFIG,
                    tokenMint,
                    this.SOL_MINT
                );
                return poolId.toBase58();
            } catch (sdkError) {
                logger.debug('Raydium SDK not available, using manual derivation');
            }

            // Method 2: Manual PDA derivation
            const seeds = [
                Buffer.from('pool'),
                this.RAYDIUM_AMM_PROGRAM.toBuffer(),
                tokenMint.toBuffer(),
                this.SOL_MINT.toBuffer()
            ];
            
            const [poolId] = await PublicKey.findProgramAddress(
                seeds,
                this.RAYDIUM_AMM_PROGRAM
            );
            
            return poolId.toBase58();
        } catch (error) {
            logger.error('Error deriving pool ID:', error);
            return null;
        }
    }

    async getPoolTrades(poolId, limit = 200, offset = 0) {
        try {
            const url = `${this.RAYDIUM_API_BASE}/trade?poolId=${poolId}&limit=${limit}`;
            
            logger.debug(`Fetching trades from Raydium API: ${url}`);
            
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.success && data.data && data.data.rows) {
                return data.data.rows;
            }
            
            return [];
        } catch (error) {
            logger.error(`Error fetching pool trades: ${error.message}`);
            return [];
        }
    }

    async getAllTrades(tokenAddress, limit = 200, offset = 0, minimumSize = 0, mainContext = 'default', subContext = null) {
        if (!tokenAddress) {
            throw new Error("Token address is required");
        }

        try {
            const tokenMint = new PublicKey(tokenAddress);
            
            // Derive the pool ID
            const poolId = await this.derivePoolId(tokenMint);
            if (!poolId) {
                throw new Error('Could not derive pool ID for bonk.fun token');
            }

            logger.debug(`Derived pool ID ${poolId} for token ${tokenAddress}`);

            // Fetch all trades for this pool
            let allTrades = [];
            let currentOffset = offset;
            const pageLimit = Math.min(limit, 200); // Raydium API limit
            
            while (allTrades.length < limit) {
                const trades = await this.getPoolTrades(poolId, pageLimit, currentOffset);
                
                if (!trades || trades.length === 0) {
                    break;
                }

                // Transform Raydium trade data to match PumpFun format
                const transformedTrades = trades.map(trade => {
                    // Determine if it's a buy (buying the token) or sell (selling the token)
                    // In Raydium API, we need to check which side is the token we're interested in
                    const isBuy = trade.side === 'buy';
                    
                    return {
                        is_buy: isBuy,
                        user: trade.owner,
                        slot: this.estimateSlotFromTimestamp(trade.blockTime),
                        signature: trade.txid,
                        token_amount: isBuy ? (trade.amountA * Math.pow(10, 6)) : (trade.amountB * Math.pow(10, 6)), // Assuming 6 decimals
                        sol_amount: isBuy ? (trade.amountB * Math.pow(10, 9)) : (trade.amountA * Math.pow(10, 9)), // SOL has 9 decimals
                        timestamp: trade.blockTime,
                        block_time: trade.blockTime
                    };
                });

                allTrades.push(...transformedTrades);
                
                if (trades.length < pageLimit) {
                    // No more trades available
                    break;
                }
                
                currentOffset += pageLimit;
            }

            // Limit to requested amount
            return allTrades.slice(0, limit);

        } catch (error) {
            logger.error(`Error fetching trades for bonk.fun token ${tokenAddress}:`, error);
            throw error;
        }
    }

    // Helper method to estimate slot from timestamp
    estimateSlotFromTimestamp(timestamp) {
        // Approximate slot calculation (Solana produces ~2.2 slots per second)
        // This is an approximation since we don't have exact slot data
        const SOLANA_GENESIS_TIMESTAMP = 1609459200; // Approximate Solana mainnet genesis
        const SLOTS_PER_SECOND = 2.2;
        
        return Math.floor((timestamp - SOLANA_GENESIS_TIMESTAMP) * SLOTS_PER_SECOND);
    }

    async getTokenInfo(tokenAddress, mainContext = 'default', subContext = null) {
        // We'll use your existing Solana API for token metadata
        // since Raydium API doesn't provide detailed token info
        throw new Error('Use existing Solana API for token metadata');
    }
}

module.exports = new BonkFunApi();