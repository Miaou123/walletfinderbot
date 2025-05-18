// src/database/services/tokenVerificationService.js

const { getDatabase } = require('../config/connection');
const logger = require('../../utils/logger');
const { getSolanaApi } = require('../../integrations/solanaApi');
const { getHolders } = require('../../tools/getHolders');
const { PublicKey } = require('@solana/web3.js');

// Import VerifiedUser model directly to avoid circular dependency
const VerifiedUser = require('../models/verified_user');

// Configuration values from environment or config
const config = require('../../utils/config');
const TOKEN_ADDRESS = config.TOKEN_ADDRESS || process.env.TOKEN_ADDRESS;
const MIN_TOKEN_THRESHOLD = parseInt(config.MIN_TOKEN_THRESHOLD || process.env.MIN_TOKEN_THRESHOLD || '1');
const VERIFICATION_AMOUNT = 0.001; // Amount of tokens to send for verification (very small)

// Debug the configuration values
logger.debug('Token verification configuration:', {
    TOKEN_ADDRESS,
    MIN_TOKEN_THRESHOLD,
    VERIFICATION_AMOUNT
});

/**
 * Service for handling token verification operations
 */
class TokenVerificationService {
    /**
     * Get the token verification collection
     * @returns {Promise<Collection>} MongoDB collection
     */
    static async getCollection() {
        const db = await getDatabase();
        return db.collection('tokenVerification');
    }

    /**
     * Create a verification session for a user
     * @param {string} userId - Telegram user ID
     * @param {string} username - Telegram username
     * @param {string} chatId - Telegram chat ID
     * @returns {Promise<Object>} - Created session object
     */
    static async createVerificationSession(userId, username, chatId) {
        try {
            const collection = await this.getCollection();
            
            // Generate a verification address keypair
            const keypairInfo = await this.generateVerificationAddress();
            
            const sessionId = `verify_${Date.now()}_${userId}`;
            const expiresAt = new Date(Date.now() + (30 * 60 * 1000)); // 30 minutes
            
            const session = {
                sessionId,
                userId,
                username,
                chatId,
                paymentAddress: keypairInfo.paymentAddress,
                privateKey: keypairInfo.privateKey,
                verificationAmount: VERIFICATION_AMOUNT,
                status: 'pending',
                createdAt: new Date(),
                expiresAt,
                lastChecked: null,
                walletAddress: null, // Will be filled when verified
                tokenBalance: 0, // Will be updated when verified
                lastUpdated: new Date()
            };
            
            // Instead of directly inserting, check for and delete existing sessions
            await collection.deleteMany({ userId, status: 'pending' });
            await collection.insertOne(session);
            
            logger.debug(`Created verification session for user ${userId} with payment address ${keypairInfo.paymentAddress}`);
            
            return session;
        } catch (error) {
            logger.error(`Error creating token verification session for ${userId}:`, error);
            throw error;
        }
    }
    
    /**
     * Generate a verification address for the user
     * @returns {Promise<Object>} - Verification wallet keypair info
     */
    static async generateVerificationAddress() {
        try {
            // Use Solana keypair generation just like in the subscription system
            const { Keypair } = require('@solana/web3.js');
            
            // Generate a new keypair for this verification
            const paymentKeypair = Keypair.generate();
            const publicKey = paymentKeypair.publicKey.toString();
            const base64Key = Buffer.from(paymentKeypair.secretKey).toString('base64');
            
            logger.debug(`Generated verification address: ${publicKey}`);
            
            return {
                paymentAddress: publicKey,
                privateKey: base64Key
            };
        } catch (error) {
            logger.error('Error generating verification address:', error);
            throw error;
        }
    }
    
    /**
     * Get a verification session by ID
     * @param {string} sessionId - Session identifier
     * @returns {Promise<Object|null>} - Session object or null if not found
     */
    static async getVerificationSession(sessionId) {
        try {
            const collection = await this.getCollection();
            return await collection.findOne({ sessionId });
        } catch (error) {
            logger.error(`Error retrieving verification session ${sessionId}:`, error);
            return null;
        }
    }
    
/**
 * Check if a verification transaction has been completed
 * @param {string} sessionId - Session identifier
 * @returns {Promise<Object>} - Status information
 */
static async checkVerification(sessionId) {
    try {
      const collection = await this.getCollection();
      const session = await collection.findOne({ sessionId });
      
      if (!session) {
        return { success: false, reason: 'Session not found' };
      }
      
      if (session.status === 'verified') {
        return { success: true, alreadyVerified: true, walletAddress: session.walletAddress };
      }
      
      if (session.expiresAt < new Date()) {
        return { success: false, reason: 'Session expired' };
      }
      
      // Check for token transfer to verification address
      const solanaApi = getSolanaApi();
      
      // Get recent transactions to the verification address
      const verificationAddress = session.paymentAddress;
      if (!verificationAddress) {
        return { success: false, reason: 'Invalid verification address' };
      }
      
      // Track this check attempt
      let retryAttempt = (session.retryCount || 0) + 1;
      await this.updateVerificationSession(sessionId, { 
        retryCount: retryAttempt,
        lastChecked: new Date()
      });
      
      // 1) Get transaction signatures for the address
      let signatures = [];
      try {
        logger.debug(`Getting signatures for address ${verificationAddress} (attempt ${retryAttempt})`);
        signatures = await solanaApi.getSignaturesForAddress(
          new PublicKey(verificationAddress),
          { limit: 10 }
        );
      } catch (error) {
        logger.error(`Error getting signatures for address ${verificationAddress}:`, error);
        return { success: false, reason: 'Error checking signatures' };
      }
      
      // If third attempt with no signatures, provide clearer feedback
      if (signatures.length === 0 && retryAttempt >= 3) {
        return { 
          success: false, 
          reason: 'Verification transfer not detected yet',
          note: 'No transactions found after multiple attempts. Please check if you sent the tokens to the correct address.'
        };
      }
      
      // Find a transaction that happened after session creation
      let senderWallet = null;
      let transactionHash = null;
      
      // If we have signatures, check them
      if (signatures && signatures.length > 0) {
        for (const tx of signatures) {
          // Skip if transaction has an error or was before the session was created
          if (tx.err || (tx.blockTime && new Date(tx.blockTime * 1000) < session.createdAt)) {
            continue;
          }
          
          // Get transaction details
          try {
            const txDetails = await solanaApi.getTransaction(
              tx.signature,
              { encoding: 'jsonParsed' }
            );
            
            // Check for token transfer
            if (TOKEN_ADDRESS ? 
              this.isTokenTransfer(txDetails, TOKEN_ADDRESS, verificationAddress) : 
              this.hasAnyTokenTransfer(txDetails, verificationAddress)) {
              senderWallet = this.getSenderFromTransaction(txDetails);
              transactionHash = tx.signature;
              break;
            }
          } catch (error) {
            logger.error(`Error checking transaction ${tx.signature}:`, error);
            continue;
          }
        }
      }
      
      if (!senderWallet) {
        return { 
          success: false, 
          reason: 'Verification transfer not detected yet'
        };
      }
      
      // Check if token address is available
      if (!TOKEN_ADDRESS) {
        logger.warn(`TOKEN_ADDRESS is not defined. Skipping token balance check.`);
        
        // If no token address is defined, consider verification successful based on transfer only
        await this.updateVerificationSession(sessionId, {
          status: 'verified',
          walletAddress: senderWallet,
          tokenBalance: MIN_TOKEN_THRESHOLD, // Default to minimum
          verifiedAt: new Date(),
          lastChecked: new Date(),
          transactionHash
        });
        
        // Also create/update the verified record - IMPORTANT: Only update the appropriate collection
        try {
          // Check if this is a group verification session
          if (session.type === 'group') {
            // This is a group verification - only update verifiedGroups
            await this.updateVerifiedGroupRecord(
              session.groupId,
              session.groupName,
              session.adminUserId,
              session.adminUsername,
              senderWallet,
              MIN_TOKEN_THRESHOLD,
              transactionHash,
              sessionId
            );
          } else {
            // This is a user verification - only update verifiedUsers
            await this.updateVerifiedUserRecord(
              session.userId,
              session.username,
              senderWallet,
              MIN_TOKEN_THRESHOLD,
              transactionHash,
              sessionId
            );
          }
        } catch (error) {
          logger.error(`Error updating verified record: ${error.message}`);
          // Continue anyway to return success to the user
        }
        
        return { 
          success: true, 
          walletAddress: senderWallet, 
          tokenBalance: MIN_TOKEN_THRESHOLD,
          transactionHash,
          note: 'Token balance check skipped - TOKEN_ADDRESS not defined'
        };
      }
      
      // Get user's token balance
      let tokenBalance = 0;
      
      try {
        // Check if sender holds enough tokens
        const holders = await getHolders(TOKEN_ADDRESS);
        logger.debug(`Found ${holders?.length || 0} holders for token ${TOKEN_ADDRESS}`);
        
        // Find the holder and safely assign it
        const holderInfo = holders?.find(h => h.address === senderWallet);
        
        if (!holderInfo || holderInfo.balance < MIN_TOKEN_THRESHOLD) {
          return { 
            success: false, 
            reason: 'Insufficient token balance',
            walletAddress: senderWallet,
            tokenBalance: holderInfo ? holderInfo.balance : 0
          };
        }
        
        // If we get here, we have a valid holder with sufficient tokens
        tokenBalance = holderInfo.balance;
        
      } catch (error) {
        logger.error(`Error checking token balance for wallet ${senderWallet}:`, error);
        
        // If token balance check fails, proceed with verification anyway using default values
        await this.updateVerificationSession(sessionId, {
          status: 'verified',
          walletAddress: senderWallet,
          tokenBalance: MIN_TOKEN_THRESHOLD, // Default to minimum
          verifiedAt: new Date(),
          lastChecked: new Date(),
          transactionHash
        });
        
        // IMPORTANT: Only update the appropriate collection based on session type
        try {
          // Check if this is a group verification
          if (session.type === 'group') {
            // Group verification - only update verifiedGroups
            await this.updateVerifiedGroupRecord(
              session.groupId,
              session.groupName,
              session.adminUserId,
              session.adminUsername,
              senderWallet,
              MIN_TOKEN_THRESHOLD,
              transactionHash,
              sessionId
            );
          } else {
            // User verification - only update verifiedUsers
            await this.updateVerifiedUserRecord(
              session.userId,
              session.username,
              senderWallet,
              MIN_TOKEN_THRESHOLD,
              transactionHash,
              sessionId
            );
          }
        } catch (error) {
          logger.error(`Error updating verified record: ${error.message}`);
          // Continue anyway to return success to the user
        }
        
        return { 
          success: true, 
          walletAddress: senderWallet, 
          tokenBalance: MIN_TOKEN_THRESHOLD, // Default to minimum
          transactionHash,
          note: 'Token balance check failed but proceeding with verification'
        };
      }
      
      // Now update verification session with our safely established values
      await this.updateVerificationSession(sessionId, {
        status: 'verified',
        walletAddress: senderWallet,
        tokenBalance: tokenBalance, // Using our safely set tokenBalance
        verifiedAt: new Date(),
        lastChecked: new Date(),
        transactionHash
      });
      
      // IMPORTANT: Only update the appropriate collection based on session type
      try {
        // Check if this is a group verification
        if (session.type === 'group') {
          // Group verification - only update verifiedGroups collection
          await this.updateVerifiedGroupRecord(
            session.groupId,
            session.groupName,
            session.adminUserId,
            session.adminUsername,
            senderWallet,
            tokenBalance,
            transactionHash,
            sessionId
          );
        } else {
          // User verification - only update verifiedUsers collection
          await this.updateVerifiedUserRecord(
            session.userId,
            session.username,
            senderWallet,
            tokenBalance,
            transactionHash,
            sessionId
          );
        }
      } catch (error) {
        logger.error(`Error updating verified record: ${error.message}`);
        // Continue anyway to return success to the user
      }
      
      return { 
        success: true, 
        walletAddress: senderWallet, 
        tokenBalance: tokenBalance,
        transactionHash
      };
    } catch (error) {
      logger.error(`Error checking verification for session ${sessionId}:`, error);
      return { success: false, reason: 'Error checking verification' };
    }
  }
    
    /**
     * Update the verified user record in the database
     * This is separated to handle mongoose model errors better
     */
    static async updateVerifiedUserRecord(userId, username, walletAddress, tokenBalance, transactionHash, sessionId) {
        try {
            const verifiedUserData = {
                userId: userId,
                username: username,
                walletAddress: walletAddress,
                tokenBalance: tokenBalance,
                verifiedAt: new Date(),
                lastChecked: new Date(),
                isActive: true,
                transactionHash,
                sessionId
            };
            
            // Use direct MongoDB methods to avoid mongoose timeouts
            const db = await getDatabase();
            const collection = db.collection('verifiedUsers');
            
            await collection.updateOne(
                { userId: userId },
                { $set: verifiedUserData },
                { upsert: true }
            );
            
            return true;
        } catch (error) {
            logger.error(`Error in updateVerifiedUserRecord: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * Check if a transaction is a token transfer of the required token
     * @param {Object} txDetails - Transaction details from blockchain
     * @param {string} tokenAddress - Token contract address 
     * @param {string} destinationAddress - Destination wallet
     * @returns {boolean} - True if it's a valid token transfer
     */
    static isTokenTransfer(txDetails, tokenAddress, destinationAddress) {
        try {
            logger.debug('Checking token transfer in transaction:', { 
                signature: txDetails?.transaction?.signatures?.[0],
                tokenAddress, 
                destinationAddress 
            });
            
            if (!txDetails?.transaction?.message?.accountKeys || 
                !txDetails?.meta?.postTokenBalances || 
                !txDetails?.meta?.preTokenBalances) {
                logger.debug('Missing required transaction fields for token transfer check');
                return false;
            }

            // Log all token mints in this transaction for debugging
            const allTokenMints = txDetails.meta.postTokenBalances.map(tb => tb.mint);
            logger.debug(`All token mints in transaction: ${JSON.stringify(allTokenMints)}`);
            
            // For SPL tokens, check post token balances to find transfers
            const postTokenBalances = txDetails.meta.postTokenBalances || [];
            const preTokenBalances = txDetails.meta.preTokenBalances || [];
            
            // Find our TOKEN_ADDRESS in the transaction's token balances
            const tokenTransfers = postTokenBalances.filter(tb => 
                tb.mint === tokenAddress && 
                // Either the destination is the address we're looking for
                (tb.owner === destinationAddress ||
                // Or the account is an associated token account for that address
                tb.owner === destinationAddress.toString())
            );
            
            // If we found our token in post balances
            if (tokenTransfers.length > 0) {
                logger.debug(`Found ${tokenTransfers.length} relevant token balance entries`);
                
                for (const transfer of tokenTransfers) {
                    // Find pre-balance for this token account
                    const preBalance = preTokenBalances.find(pb => 
                        pb.accountIndex === transfer.accountIndex
                    );
                    
                    // Check if the balance increased (token received)
                    if (preBalance) {
                        const preAmount = preBalance.uiTokenAmount?.uiAmount || 0;
                        const postAmount = transfer.uiTokenAmount?.uiAmount || 0;
                        const change = postAmount - preAmount;
                        
                        logger.debug(`Token balance change in account ${transfer.owner}: ${change} tokens`);
                        
                        if (change > 0) {
                            // Positive change means tokens were received
                            return true;
                        }
                    } else if (transfer.uiTokenAmount?.uiAmount > 0) {
                        // If no pre-balance found but has tokens now, it's likely a new account creation + transfer
                        logger.debug(`New token account with balance: ${transfer.uiTokenAmount?.uiAmount}`);
                        return true;
                    }
                }
            } else {
                // If we didn't find our token in the balance changes, check all tokens in the transaction
                logger.debug(`No matching token transfers found directly for token ${tokenAddress}, checking mints`);
                
                // For Solana, check if our token appears as a mint in any token balances
                const allTokensInTx = new Set();
                if (txDetails.meta?.postTokenBalances) {
                    txDetails.meta.postTokenBalances.forEach(tb => {
                        if (tb.mint) allTokensInTx.add(tb.mint);
                    });
                }
                if (txDetails.meta?.preTokenBalances) {
                    txDetails.meta.preTokenBalances.forEach(tb => {
                        if (tb.mint) allTokensInTx.add(tb.mint);
                    });
                }
                
                // Log all tokens found in this transaction
                logger.debug(`All token mints in transaction: ${Array.from(allTokensInTx).join(', ')}`);
                
                // If our token appears anywhere in the transaction, consider it valid
                if (allTokensInTx.has(tokenAddress)) {
                    logger.debug(`Found our token in transaction mints: ${tokenAddress}`);
                    return true;
                }
            }
            
            // Check for token program instructions as fallback
            const instructions = txDetails.transaction?.message?.instructions || [];
            for (const ix of instructions) {
                // Token program ID for SPL tokens
                if (ix.programId === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
                    logger.debug('Found SPL token program instruction, may be a token transfer');
                    return true;
                }
            }
            
            return false;
        } catch (error) {
            logger.error('Error checking for token transfer:', error);
            // In case of error, assume it might be a token transfer and proceed with verification
            return true;
        }
    }
    
    /**
     * Check if a transaction contains any token transfer 
     * @param {Object} txDetails - Transaction details
     * @param {string} destinationAddress - Destination wallet address
     * @returns {boolean} - True if any token transfer is found
     */
    static hasAnyTokenTransfer(txDetails, destinationAddress) {
        try {
            logger.debug('Checking for any token transfer in transaction:', { 
                signature: txDetails?.transaction?.signatures?.[0]
            });
            
            if (!txDetails?.transaction?.message?.accountKeys || 
                !txDetails?.meta?.postTokenBalances) {
                return false;
            }

            // For SPL tokens, check if we have any token program instructions
            const instructions = txDetails.transaction?.message?.instructions || [];
            const hasTokenInstruction = instructions.some(ix => 
                ix.programId === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
            );
            
            if (hasTokenInstruction) {
                logger.debug('Found SPL token program instruction, assuming it\'s a token transfer');
                return true;
            }
            
            // Check for any token balance changes
            const postTokenBalances = txDetails.meta.postTokenBalances || [];
            
            // If there are any token balances at all, it's likely a token transaction
            if (postTokenBalances.length > 0) {
                logger.debug(`Found ${postTokenBalances.length} token balance entries in transaction`);
                return true;
            }
            
            return false;
        } catch (error) {
            logger.error('Error checking for any token transfer:', error);
            return false;
        }
    }
    
    /**
     * Get the sender wallet from a transaction
     * @param {Object} txDetails - Transaction details
     * @returns {string|null} - Sender wallet address
     */
    static getSenderFromTransaction(txDetails) {
        try {
            if (!txDetails?.transaction?.message?.accountKeys) {
                return null;
            }
            
            // Log the account keys for debugging
            const accountKeys = txDetails.transaction.message.accountKeys;
            logger.debug(`Transaction account keys: ${JSON.stringify(accountKeys.map(k => k.pubkey || k))}`);
            
            // First, check token senders from token balances (most reliable)
            if (txDetails.meta?.preTokenBalances && txDetails.meta?.postTokenBalances) {
                const preBalances = txDetails.meta.preTokenBalances;
                const postBalances = txDetails.meta.postTokenBalances;
                
                // Look for accounts with decreased token balance (sender)
                for (const pre of preBalances) {
                    const post = postBalances.find(p => p.accountIndex === pre.accountIndex);
                    if (post) {
                        const preAmount = pre.uiTokenAmount?.uiAmount || 0;
                        const postAmount = post.uiTokenAmount?.uiAmount || 0;
                        
                        if (preAmount > postAmount) {
                            // This account sent tokens
                            const senderOwner = pre.owner;
                            logger.debug(`Found token sender: ${senderOwner}`);
                            return senderOwner;
                        }
                    }
                }
            }
            
            // If we couldn't determine the sender from token balances, use the first signer
            if (txDetails.transaction?.message?.header?.numRequiredSignatures > 0) {
                // Handle different possible formats of accountKeys
                const signer = accountKeys[0].pubkey || accountKeys[0];
                logger.debug(`Using first signer as sender: ${signer}`);
                return signer;
            }
            
            // Last resort: just use the first account key
            if (accountKeys.length > 0) {
                const firstKey = accountKeys[0].pubkey || accountKeys[0];
                logger.debug(`Using first account as sender: ${firstKey}`);
                return firstKey;
            }
            
            return null;
        } catch (error) {
            logger.error('Error extracting sender from transaction:', error);
            return null;
        }
    }
    
    /**
     * Update a verification session with new data
     * @param {string} sessionId - Session identifier
     * @param {Object} updateData - Data to update
     * @returns {Promise<boolean>} - True if successful
     */
    static async updateVerificationSession(sessionId, updateData) {
        try {
            const collection = await this.getCollection();
            
            await collection.updateOne(
                { sessionId },
                { $set: { ...updateData, lastUpdated: new Date() } }
            );
            
            return true;
        } catch (error) {
            logger.error(`Error updating verification session ${sessionId}:`, error);
            throw error;
        }
    }
    
    /**
     * Get verified wallet for a user
     * @param {string} userId - User ID
     * @returns {Promise<Object|null>} - Verified wallet info or null
     */
    static async getVerifiedWallet(userId) {
        try {
            // Use direct MongoDB methods to avoid mongoose timeouts
            const db = await getDatabase();
            const collection = db.collection('verifiedUsers');
            
            // First check the VerifiedUser collection
            const verifiedUser = await collection.findOne(
                { userId, isActive: true },
                { sort: { verifiedAt: -1 } }
            );
            
            if (verifiedUser) {
                return verifiedUser;
            }
            
            // Fall back to the sessions collection if not found in main collection
            const sessionsCollection = await this.getCollection();
            
            const session = await sessionsCollection.findOne(
                { userId, status: 'verified' },
                { sort: { verifiedAt: -1 } }
            );
            
            return session;
        } catch (error) {
            logger.error(`Error getting verified wallet for user ${userId}:`, error);
            return null;
        }
    }
    
/**
 * Check if a user has verified status with sufficient tokens
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - Access status
 */
static async checkVerifiedStatus(userId) {
    try {
      // Always check the verifiedUsers collection first
      const db = await getDatabase();
      const verifiedUsersCollection = db.collection('verifiedUsers');
      
      // Look for the user in the correct collection
      const verifiedUser = await verifiedUsersCollection.findOne({ 
        userId: userId.toString(),
        isActive: true 
      });
      
      if (verifiedUser) {
        logger.debug(`Found verified user ${userId} in verifiedUsers collection`);
        
        // If last check was recent, use cached result
        const cacheTime = 30 * 60 * 1000; // 30 minutes
        if (verifiedUser.lastChecked && 
            (new Date() - new Date(verifiedUser.lastChecked)) < cacheTime) {
          
          return {
            hasAccess: verifiedUser.tokenBalance >= MIN_TOKEN_THRESHOLD,
            walletAddress: verifiedUser.walletAddress,
            tokenBalance: verifiedUser.tokenBalance,
            fromCollection: 'verifiedUsers'
          };
        }
        
        // If TOKEN_ADDRESS is not defined, skip balance check
        if (!TOKEN_ADDRESS) {
          return {
            hasAccess: true,
            walletAddress: verifiedUser.walletAddress,
            tokenBalance: verifiedUser.tokenBalance || MIN_TOKEN_THRESHOLD,
            fromCollection: 'verifiedUsers'
          };
        }
        
        // Check current token balance
        const holders = await getHolders(TOKEN_ADDRESS);
        const holder = holders.find(h => h.address === verifiedUser.walletAddress);
        
        const tokenBalance = holder ? holder.balance : 0;
        const hasAccess = tokenBalance >= MIN_TOKEN_THRESHOLD;
        
        // Update cached balance in verifiedUsers collection
        await verifiedUsersCollection.updateOne(
          { userId: userId.toString() },
          {
            $set: {
              tokenBalance,
              lastChecked: new Date(),
              isActive: hasAccess
            }
          }
        );
        
        return {
          hasAccess,
          walletAddress: verifiedUser.walletAddress,
          tokenBalance,
          fromCollection: 'verifiedUsers'
        };
      }
      
      // Only as a fallback, check the tokenVerification collection
      logger.debug(`User ${userId} not found in verifiedUsers collection, checking tokenVerification as fallback`);
      
      const tokenVerificationCollection = await this.getCollection();
      const session = await tokenVerificationCollection.findOne({
        userId: userId.toString(),
        status: 'verified',
        type: { $ne: 'group' } // Ensure it's not a group verification
      }, { sort: { verifiedAt: -1 } });
      
      if (session) {
        logger.warn(`Found user ${userId} in tokenVerification but not in verifiedUsers - data inconsistency`);
        
        // If found in tokenVerification, migrate it to verifiedUsers for future lookups
        try {
          await this.updateVerifiedUserRecord(
            session.userId,
            session.username || null,
            session.walletAddress,
            session.tokenBalance || MIN_TOKEN_THRESHOLD,
            session.transactionHash || null,
            session.sessionId
          );
          
          logger.info(`Migrated user ${userId} from tokenVerification to verifiedUsers collection`);
        } catch (error) {
          logger.error(`Failed to migrate user ${userId} to verifiedUsers:`, error);
        }
        
        return {
          hasAccess: session.tokenBalance >= MIN_TOKEN_THRESHOLD,
          walletAddress: session.walletAddress,
          tokenBalance: session.tokenBalance,
          fromCollection: 'tokenVerification'
        };
      }
      
      return { hasAccess: false, reason: 'not_verified' };
    } catch (error) {
      logger.error(`Error checking verified status for user ${userId}:`, error);
      
      // If we can't check, assume no access
      return { hasAccess: false, reason: 'error' };
    }
  }
    
    /**
     * Periodic check of all verified wallets to update token balances
     * @returns {Promise<Object>} - Result information including revoked users
     */
    static async checkAllVerifiedWallets() {
        try {
            // Use direct MongoDB to avoid mongoose timeouts
            const db = await getDatabase();
            const verifiedUsersCollection = db.collection('verifiedUsers');
            
            // Get all active verified users
            const verifiedUsers = await verifiedUsersCollection.find({ isActive: true }).toArray();
            
            logger.info(`Checking balances for ${verifiedUsers.length} verified wallets`);
            
            // Skip balance checking if no token address is defined
            if (!TOKEN_ADDRESS) {
                logger.warn('TOKEN_ADDRESS is not defined. Skipping balance check.');
                return {
                    success: true,
                    checkedCount: verifiedUsers.length,
                    revokedCount: 0,
                    revokedUsers: []
                };
            }
            
            // Get all holders in one call for efficiency
            const holders = await getHolders(TOKEN_ADDRESS);
            const holdersMap = {};
            
            holders.forEach(holder => {
                holdersMap[holder.address] = holder.balance;
            });
            
            // Check each wallet and prepare bulk operations
            const bulkOps = [];
            const revokedUsers = [];
            
            for (const user of verifiedUsers) {
                const tokenBalance = holdersMap[user.walletAddress] || 0;
                const hasAccess = tokenBalance >= MIN_TOKEN_THRESHOLD;
                
                bulkOps.push({
                    updateOne: {
                        filter: { _id: user._id },
                        update: { 
                            $set: { 
                                tokenBalance, 
                                lastChecked: new Date(),
                                isActive: hasAccess
                            } 
                        }
                    }
                });
                
                // If access was just revoked, track for notifications
                if (!hasAccess && user.isActive) {
                    logger.info(`Access revoked for user ${user.userId} - insufficient tokens`);
                    revokedUsers.push({
                        userId: user.userId,
                        username: user.username,
                        tokenBalance,
                        walletAddress: user.walletAddress
                    });
                }
            }
            
            // Execute all updates in bulk
            if (bulkOps.length > 0) {
                await verifiedUsersCollection.bulkWrite(bulkOps);
            }
            
            logger.info(`Completed balance check for ${verifiedUsers.length} wallets`);
            return {
                success: true,
                checkedCount: verifiedUsers.length,
                revokedCount: revokedUsers.length,
                revokedUsers
            };
        } catch (error) {
            logger.error('Error in periodic wallet verification check:', error);
            return { success: false, error: error.message };
        }
    }


/**
 * Create a verification session for a group
 * @param {string} groupId - Telegram group ID
 * @param {string} groupName - Telegram group name
 * @param {string} adminUserId - Admin user ID
 * @param {string} adminUsername - Admin username
 * @returns {Promise<Object>} - Created session object
 */
static async createGroupVerificationSession(groupId, groupName, adminUserId, adminUsername) {
    try {
        const collection = await this.getCollection();
        
        // Generate a verification address keypair
        const keypairInfo = await this.generateVerificationAddress();
        
        const sessionId = `verify_group_${Date.now()}_${groupId}`;
        const expiresAt = new Date(Date.now() + (30 * 60 * 1000)); // 30 minutes
        
        const session = {
            sessionId,
            type: 'group', // Important to distinguish from user verification
            groupId,
            groupName,
            adminUserId,
            adminUsername,
            paymentAddress: keypairInfo.paymentAddress,
            privateKey: keypairInfo.privateKey,
            verificationAmount: VERIFICATION_AMOUNT,
            status: 'pending',
            createdAt: new Date(),
            expiresAt,
            lastChecked: null,
            walletAddress: null, // Will be filled when verified
            tokenBalance: 0, // Will be updated when verified
            lastUpdated: new Date()
        };
        
        // Instead of directly inserting, check for and delete existing sessions
        await collection.deleteMany({ groupId, status: 'pending' });
        await collection.insertOne(session);
        
        logger.debug(`Created group verification session for group ${groupId} with payment address ${keypairInfo.paymentAddress}`);
        
        return session;
    } catch (error) {
        logger.error(`Error creating group verification session for ${groupId}:`, error);
        throw error;
    }
}

/**
 * Get verified group information
 * @param {string} groupId - Group ID from Telegram
 * @returns {Promise<Object|null>} - Verified group info or null
 */
static async getVerifiedGroup(groupId) {
    try {
        // Use direct MongoDB methods to avoid mongoose timeouts
        const db = await getDatabase();
        const collection = db.collection('verifiedGroups');
        
        // First check the VerifiedGroup collection
        const verifiedGroup = await collection.findOne(
            { groupId, isActive: true },
            { sort: { verifiedAt: -1 } }
        );
        
        if (verifiedGroup) {
            return verifiedGroup;
        }
        
        // Fall back to the sessions collection if not found in main collection
        const sessionsCollection = await this.getCollection();
        
        const session = await sessionsCollection.findOne(
            { groupId, status: 'verified', type: 'group' },
            { sort: { verifiedAt: -1 } }
        );
        
        return session;
    } catch (error) {
        logger.error(`Error getting verified group for "${groupId}":`, error);
        return null;
    }
}

/**
 * Check if a group has verified status with sufficient tokens
 * @param {string} groupId - Group ID
 * @returns {Promise<Object>} - Access status
 */
static async checkGroupVerifiedStatus(groupId) {
    try {
      // Always check the verifiedGroups collection first for proper status
      const db = await getDatabase();
      const verifiedGroupsCollection = db.collection('verifiedGroups');
      
      // Look for the group in the correct collection
      const verifiedGroup = await verifiedGroupsCollection.findOne({ 
        groupId: groupId.toString(),
        isActive: true
      });
      
      if (verifiedGroup) {
        logger.debug(`Found verified group ${groupId} in verifiedGroups collection`);
        
        // If last check was recent, use cached result
        const cacheTime = 30 * 60 * 1000; // 30 minutes
        if (verifiedGroup.lastChecked && 
            (new Date() - new Date(verifiedGroup.lastChecked)) < cacheTime) {
          
          return {
            hasAccess: verifiedGroup.tokenBalance >= MIN_TOKEN_THRESHOLD,
            walletAddress: verifiedGroup.walletAddress,
            tokenBalance: verifiedGroup.tokenBalance,
            fromCollection: 'verifiedGroups'
          };
        }
        
        // If TOKEN_ADDRESS is not defined, skip balance check
        if (!TOKEN_ADDRESS) {
          return {
            hasAccess: true,
            walletAddress: verifiedGroup.walletAddress,
            tokenBalance: verifiedGroup.tokenBalance || MIN_TOKEN_THRESHOLD,
            fromCollection: 'verifiedGroups'
          };
        }
        
        // Check current token balance
        const holders = await getHolders(TOKEN_ADDRESS);
        const holder = holders.find(h => h.address === verifiedGroup.walletAddress);
        
        const tokenBalance = holder ? holder.balance : 0;
        const hasAccess = tokenBalance >= MIN_TOKEN_THRESHOLD;
        
        // Update the verified group record
        await verifiedGroupsCollection.updateOne(
          { groupId: groupId.toString() },
          {
            $set: {
              tokenBalance,
              lastChecked: new Date(),
              isActive: hasAccess
            }
          }
        );
        
        return {
          hasAccess,
          walletAddress: verifiedGroup.walletAddress,
          tokenBalance,
          fromCollection: 'verifiedGroups'
        };
      }
      
      // If not found in verifiedGroups, ONLY as a fallback check the tokenVerification collection
      logger.debug(`Group ${groupId} not found in verifiedGroups collection, checking tokenVerification as fallback`);
      
      const tokenVerificationCollection = await this.getCollection();
      const session = await tokenVerificationCollection.findOne({
        groupId: groupId.toString(),
        status: 'verified',
        type: 'group'
      }, { sort: { verifiedAt: -1 } });
      
      if (session) {
        logger.warn(`Found group ${groupId} in tokenVerification but not in verifiedGroups - data inconsistency`);
        
        // If found in tokenVerification, migrate it to verifiedGroups for future lookups
        try {
          await this.updateVerifiedGroupRecord(
            session.groupId,
            session.groupName || 'Unknown Group',
            session.adminUserId || null,
            session.adminUsername || null,
            session.walletAddress,
            session.tokenBalance || MIN_TOKEN_THRESHOLD,
            session.transactionHash || null,
            session.sessionId
          );
          
          logger.info(`Migrated group ${groupId} from tokenVerification to verifiedGroups collection`);
        } catch (error) {
          logger.error(`Failed to migrate group ${groupId} to verifiedGroups:`, error);
        }
        
        return {
          hasAccess: session.tokenBalance >= MIN_TOKEN_THRESHOLD,
          walletAddress: session.walletAddress,
          tokenBalance: session.tokenBalance,
          fromCollection: 'tokenVerification'
        };
      }
      
      return { hasAccess: false, reason: 'not_verified' };
    } catch (error) {
      logger.error(`Error checking group verification status for "${groupId}":`, error);
      
      // If we can't check, assume no access
      return { hasAccess: false, reason: 'error' };
    }
  }

/**
 * Update the verified group record in the database
 */
static async updateVerifiedGroupRecord(groupId, groupName, adminUserId, adminUsername, walletAddress, tokenBalance, transactionHash, sessionId) {
    try {
        const verifiedGroupData = {
            groupId,
            groupName,
            adminUserId,
            adminUsername,
            walletAddress,
            tokenBalance,
            verifiedAt: new Date(),
            lastChecked: new Date(),
            isActive: true,
            transactionHash,
            sessionId
        };
        
        // Use direct MongoDB methods to avoid mongoose timeouts
        const db = await getDatabase();
        const collection = db.collection('verifiedGroups');
        
        await collection.updateOne(
            { groupId },
            { $set: verifiedGroupData },
            { upsert: true }
        );
        
        return true;
    } catch (error) {
        logger.error(`Error in updateVerifiedGroupRecord: ${error.message}`);
        throw error;
    }
}

/**
 * Check and update token balances for all verified groups
 * Part of periodic check process
 */
static async checkAllVerifiedGroups() {
    try {
        // Use direct MongoDB methods
        const db = await getDatabase();
        const collection = db.collection('verifiedGroups');
        
        // Get all active verified groups
        const verifiedGroups = await collection.find({ isActive: true }).toArray();
        
        logger.info(`Checking balances for ${verifiedGroups.length} verified groups`);
        
        // Skip if TOKEN_ADDRESS is not defined
        if (!TOKEN_ADDRESS || verifiedGroups.length === 0) {
            return {
                success: true,
                checkedCount: verifiedGroups.length,
                revokedCount: 0,
                revokedGroups: []
            };
        }
        
        // Get all holders in one call for efficiency
        const holders = await getHolders(TOKEN_ADDRESS);
        const holdersMap = {};
        
        holders.forEach(holder => {
            holdersMap[holder.address] = holder.balance;
        });
        
        // Check each group and prepare bulk operations
        const bulkOps = [];
        const revokedGroups = [];
        
        for (const group of verifiedGroups) {
            const tokenBalance = holdersMap[group.walletAddress] || 0;
            const hasAccess = tokenBalance >= MIN_TOKEN_THRESHOLD;
            
            bulkOps.push({
                updateOne: {
                    filter: { _id: group._id },
                    update: { 
                        $set: { 
                            tokenBalance, 
                            lastChecked: new Date(),
                            isActive: hasAccess
                        } 
                    }
                }
            });
            
            // If access was just revoked, track for notifications
            if (!hasAccess && group.isActive) {
                logger.info(`Access revoked for group ${group.groupId} - insufficient tokens`);
                revokedGroups.push({
                    groupId: group.groupId,
                    groupName: group.groupName,
                    tokenBalance,
                    walletAddress: group.walletAddress
                });
            }
        }
        
        // Execute all updates in bulk
        if (bulkOps.length > 0) {
            await collection.bulkWrite(bulkOps);
        }
        
        logger.info(`Completed balance check for ${verifiedGroups.length} groups`);
        return {
            success: true,
            checkedCount: verifiedGroups.length,
            revokedCount: revokedGroups.length,
            revokedGroups
        };
    } catch (error) {
        logger.error('Error in group verification balance check:', error);
        return { success: false, error: error.message };
    }
}
}

module.exports = TokenVerificationService;