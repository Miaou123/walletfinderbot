// src/tools/tokenBalanceChecker.js
const logger = require('../utils/logger');
const { TokenVerificationService } = require('../database');
const config = require('../utils/config');

/**
 * Service for checking token balances of verified users and updating access status
 */
class TokenBalanceChecker {
    constructor(bot) {
        this.bot = bot;
        this.CHECK_INTERVAL = parseInt(process.env.BALANCE_CHECK_INTERVAL || 24) * 60 * 60 * 1000; // Default: 24 hours
        this.TOKEN_SYMBOL = config.TOKEN_SYMBOL || 'tokens';
        this.MIN_TOKEN_THRESHOLD = config.TOKEN_MIN_THRESHOLD || 1;
        this.isRunning = false;
        this.checkTimer = null;
        this.notifyUsersOnRevoke = process.env.NOTIFY_ON_REVOKE === 'true';
    }
    
    /**
     * Start periodic checking of user token balances
     */
    start() {
        if (this.isRunning) {
            logger.warn('Token balance checker is already running');
            return;
        }
        
        this.isRunning = true;
        
        // Run immediately
        this.checkAllUsers();
        
        // Set up interval
        this.checkTimer = setInterval(() => {
            this.checkAllUsers();
        }, this.CHECK_INTERVAL);
        
        logger.info(`Started periodic balance checking every ${this.CHECK_INTERVAL / (60 * 60 * 1000)} hours`);
    }
    
    /**
     * Stop the balance checker
     */
    stop() {
        if (!this.isRunning) {
            return;
        }
        
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
            this.checkTimer = null;
        }
        
        this.isRunning = false;
        logger.info('Token balance checker stopped');
    }
    
    /**
     * Check all verified users' token balances
     */
    async checkAllUsers() {
        try {
            logger.info('Starting periodic token balance check for all verified users');
            
            // This will update all verified wallets in one batch operation
            const result = await TokenVerificationService.checkAllVerifiedWallets();
            
            // If enabled, notify users whose access was revoked
            if (this.notifyUsersOnRevoke && result.revokedUsers && result.revokedUsers.length > 0) {
                await this.notifyRevokedUsers(result.revokedUsers);
            }
            
            logger.info(`Periodic token balance check completed. Checked ${result.checkedCount || 0} wallets.`);
        } catch (error) {
            logger.error('Error in periodic token balance check:', error);
        }
    }
    
    /**
     * Notify users whose access was revoked due to insufficient token balance
     * @param {Array} revokedUsers - Array of user IDs whose access was revoked
     */
    async notifyRevokedUsers(revokedUsers) {
        if (!this.bot || !revokedUsers || revokedUsers.length === 0) return;
        
        for (const user of revokedUsers) {
            try {
                await this.bot.sendMessage(
                    user.userId,
                    `⚠️ <b>Token Access Revoked</b>\n\n` +
                    `Your token balance has fallen below the required minimum of ${this.MIN_TOKEN_THRESHOLD} ${this.TOKEN_SYMBOL}.\n\n` +
                    `Current balance: ${user.tokenBalance} ${this.TOKEN_SYMBOL}\n\n` +
                    `To regain access to token-gated features, please ensure your wallet contains at least ${this.MIN_TOKEN_THRESHOLD} ${this.TOKEN_SYMBOL} and use /verify to update your verification status.`,
                    { parse_mode: 'HTML' }
                );
                logger.debug(`Sent token revocation notice to user ${user.userId}`);
            } catch (error) {
                logger.error(`Failed to send revocation notice to user ${user.userId}:`, error);
            }
        }
    }
}

module.exports = TokenBalanceChecker;