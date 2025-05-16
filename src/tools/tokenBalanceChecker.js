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
            logger.info('Starting periodic token balance check for all verified users and groups');
            
            // Check individual users first
            const userResult = await this.accessControl.tokenVerificationService.checkAllVerifiedWallets();
            
            // Then check groups
            const groupResult = await this.accessControl.tokenVerificationService.checkAllVerifiedGroups();
            
            // If enabled, notify revoked users and groups
            if (this.notifyUsersOnRevoke) {
                if (userResult.revokedUsers && userResult.revokedUsers.length > 0) {
                    await this.notifyRevokedUsers(userResult.revokedUsers);
                }
                
                if (groupResult.revokedGroups && groupResult.revokedGroups.length > 0) {
                    await this.notifyRevokedGroups(groupResult.revokedGroups);
                }
            }
            
            logger.info(`Periodic token balance check completed. Checked ${userResult.checkedCount || 0} users and ${groupResult.checkedCount || 0} groups.`);
            
            return {
                users: userResult,
                groups: groupResult
            };
        } catch (error) {
            logger.error('Error in periodic token balance check:', error);
        }
    }
    
    // Add a new method to notify revoked groups:
    async notifyRevokedGroups(revokedGroups) {
        if (!this.bot || !revokedGroups || revokedGroups.length === 0) return;
        
        for (const group of revokedGroups) {
            try {
                await this.bot.sendMessage(
                    group.groupId,
                    `⚠️ <b>Group Token Access Revoked</b>\n\n` +
                    `This group's token balance has fallen below the required minimum of ${this.MIN_TOKEN_THRESHOLD} ${this.TOKEN_SYMBOL}.\n\n` +
                    `Current balance: ${group.tokenBalance} ${this.TOKEN_SYMBOL}\n\n` +
                    `To regain access to token-gated features, please ensure the wallet contains at least ${this.MIN_TOKEN_THRESHOLD} ${this.TOKEN_SYMBOL} and use /verifygroup to update verification.`,
                    { parse_mode: 'HTML' }
                );
                logger.debug(`Sent token revocation notice to group ${group.groupId}`);
            } catch (error) {
                logger.error(`Failed to send revocation notice to group ${group.groupId}:`, error);
            }
        }
    }
}

module.exports = TokenBalanceChecker;