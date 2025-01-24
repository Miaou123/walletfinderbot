const { getDatabase } = require('../config/connection'); 
const { validateUser } = require('../models/users');
const logger = require('../../utils/logger');

class UserService {
    static async getCollection() {
        const db = await getDatabase();
        return db.collection('users');
    }

    static async createOrUpdateUser(chatId, username) {
        const collection = await this.getCollection();
    
        const userData = {
            chatId,
            username,
            referralWallet: '',
            unclaimedRewards: 0,
            claimedRewards: 0,
            referralCount: 0,
            referralClicks: 0,
            referredBy: null,
            referralUsed: false,
            lastUpdated: new Date()
        };
    
        const { error, value } = validateUser(userData);
        if (error) {
            logger.error(`User validation error for ${username}:`, error);
            throw error;
        }
    
        const result = await collection.findOneAndUpdate(
            { chatId },
            { $setOnInsert: value },
            { upsert: true, returnDocument: 'after' }
        );
    
        return result.value || value;
    }

    static async getUser(username) {
        const collection = await this.getCollection();
        return collection.findOne({ username });
    }

    static async getUserByChatId(chatId) {
        const collection = await this.getCollection();
        return collection.findOne({ chatId });
    }

    static async setReferralWallet(username, wallet) {
        const collection = await this.getCollection();
        const result = await collection.updateOne(
            { username },
            { 
                $set: { 
                    referralWallet: wallet, 
                    lastUpdated: new Date() 
                }
            }
        );
        return result.modifiedCount > 0;
    }

    static async addRewards(username, amount) {
        const collection = await this.getCollection();
        const result = await collection.updateOne(
            { username },
            { 
                $inc: { unclaimedRewards: amount },
                $set: { lastUpdated: new Date() }
            }
        );
        logger.info(`Added ${amount} SOL to unclaimedRewards for ${username}`);
        return result.modifiedCount > 0;
    }

    static async storeReferralUsage(username, referrerUsername) {
        const collection = await this.getCollection();
        await collection.updateOne(
            { username },
            { 
                $set: { 
                    referredBy: referrerUsername, 
                    referralUsed: false,
                    lastUpdated: new Date()
                }
            },
            { upsert: true }
        );

        await collection.updateOne(
            { username: referrerUsername },
            { 
                $inc: { referralClicks: 1 },
                $set: { lastUpdated: new Date() }
            }
        );
        logger.info(`Stored referral usage: ${username} referred by ${referrerUsername}`);
    }

    static async validateAndApplyReferral(username) {
        const collection = await this.getCollection();
        const user = await collection.findOne({ username });

        if (user?.referredBy && !user.referralUsed) {
            await this.incrementReferralCount(user.referredBy);
            await collection.updateOne(
                { username },
                { 
                    $set: { 
                        referralUsed: true,
                        lastUpdated: new Date() 
                    }
                }
            );
            logger.info(`Validated referral for ${username} from ${user.referredBy}`);
            return user.referredBy;
        }
        return null;
    }

    static async incrementReferralCount(username) {
        const collection = await this.getCollection();
        const result = await collection.updateOne(
            { username },
            {
                $inc: { referralCount: 1 },
                $set: { lastUpdated: new Date() }
            }
        );
        logger.info(`Incremented referral count for ${username}`);
        return result.modifiedCount > 0;
    }

    static async claimRewards(username) {
        const collection = await this.getCollection();
        const user = await collection.findOne({ username });

        if (!user) {
            return { success: false, reason: "User not found" };
        }
        if (!user.referralWallet) {
            return { success: false, reason: "No referral wallet set" };
        }
        if (user.unclaimedRewards <= 0) {
            return { success: false, reason: "No unclaimed rewards" };
        }

        const claimedAmount = user.unclaimedRewards;

        await collection.updateOne(
            { username },
            {
                $inc: { claimedRewards: claimedAmount },
                $set: { 
                    unclaimedRewards: 0,
                    lastUpdated: new Date() 
                }
            }
        );

        logger.info(`User ${username} claimed ${claimedAmount} SOL from referrals`);
        return { success: true, claimedAmount };
    }

    static async getReferralStats(username) {
        const collection = await this.getCollection();
        const user = await collection.findOne(
            { username },
            { 
                projection: { 
                    referralCount: 1,
                    referralClicks: 1,
                    unclaimedRewards: 1,
                    claimedRewards: 1,
                    referralWallet: 1 
                }
            }
        );
        return user;
    }

    static async getAllReferrers() {
        const collection = await this.getCollection();
        return await collection.find(
            { referralCount: { $gt: 0 } }
        ).toArray();
    }

    // Peut être utile pour des stats admin
    static async getTotalReferralStats() {
        const collection = await this.getCollection();
        const stats = await collection.aggregate([
            {
                $group: {
                    _id: null,
                    totalClicks: { $sum: '$referralClicks' },
                    totalUsed: { $sum: '$referralCount' },
                    totalRewardsUnclaimed: { $sum: '$unclaimedRewards' },
                    totalRewardsClaimed: { $sum: '$claimedRewards' }
                }
            }
        ]).toArray();
        return stats[0];
    }
}

module.exports = UserService;