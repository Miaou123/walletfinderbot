const { getDatabase } = require('../config/connection'); 
const { validateUser } = require('../models/users');
const logger = require('../../utils/logger');

class UserService {
    static async getCollection() {
        const db = await getDatabase();
        return db.collection('users');
    }

    static async createOrUpdateUser(msg) {
        const collection = await this.getCollection();
        const userId = msg.from.id.toString();
        const chatId = msg.chat.id.toString();
        const username = (msg.from.username || '').toLowerCase();
        const referralLink = this.generateReferralLink(username);
    
        const userData = {
            userId,                  // Nouvel identifiant principal
            chatId,                  // Gardé pour la communication
            username,
            referralLink,
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
    
        try {
            const result = await collection.findOneAndUpdate(
                { userId },          // Recherche par userId
                { $set: value },
                { upsert: true, returnDocument: 'after' }
            );
    
            return result.value || value;
        } catch (err) {
            if (err.code === 11000) {
                logger.warn(`Duplicate key error for user with userId ${userId}`);
                return await this.getUserById(userId);
            }
            throw err;
        }
    }

    static async deleteUser(username) {
        const collection = await this.getCollection();
        
        // First find the user to make sure they exist
        const user = await this.getUser(username);
        if (!user) {
            throw new Error('User not found');
        }
    
        // Remove the user from the database
        const result = await collection.deleteOne({ username: username.toLowerCase() });
        
        if (result.deletedCount === 0) {
            throw new Error('Failed to delete user');
        }
    
        // Also remove this user from any referredUsers arrays where they might appear
        await collection.updateMany(
            { referredUsers: username.toLowerCase() },
            { $pull: { referredUsers: username.toLowerCase() } }
        );
    
        return true;
    }

    // Nouvelles méthodes de recherche
    static async getUserById(userId) {
        const collection = await this.getCollection();
        return collection.findOne({ userId });
    }

    static async getUserByChatId(chatId) {
        const collection = await this.getCollection();
        return collection.findOne({ chatId });
    }

    static async getUser(username) {
        const collection = await this.getCollection();
        return collection.findOne({ username });
    }

    static generateReferralLink(username) {
        return `https://t.me/Noesis_local_bot?start=r-${username}`;
    }

    static async saveReferralLink(msg) {
        const collection = await this.getCollection();
        const userId = msg.from.id.toString();
        const username = (msg.from.username || '').toLowerCase();
        const referralLink = this.generateReferralLink(username);
    
        await collection.updateOne(
            { userId },
            { 
                $set: { 
                    referralLink,
                    lastUpdated: new Date() 
                }
            },
            { upsert: true }
        );
    
        return referralLink;
    }

    static async getUsernameFromUserId(userId) {
        const collection = await this.getCollection();
        const user = await collection.findOne({ userId }, { projection: { username: 1 } });
        return user ? user.username : null;
    }

    static async addUnclaimedRewards(userId, amount) {
        const collection = await this.getCollection();
        await collection.updateOne(
            { userId },
            { 
                $inc: { unclaimedRewards: amount },
                $set: { lastUpdated: new Date() }
            }
        );
    }

    static async isValidReferralLink(referralLink) {
        const collection = await this.getCollection();
        const user = await collection.findOne({ referralLink });
        return !!user;
    }

    static async getReferralLink(msg) {
        const collection = await this.getCollection();
        const userId = msg.from.id.toString();
        const username = (msg.from.username || '').toLowerCase();
        
        const user = await collection.findOne(
            { userId },
            { projection: { referralLink: 1 } }
        );
    
        return user?.referralLink || this.generateReferralLink(username);
    }

    static async setReferralWallet(userId, wallet) {
        const collection = await this.getCollection();
        const result = await collection.updateOne(
            { userId },
            { 
                $set: { 
                    referralWallet: wallet, 
                    lastUpdated: new Date() 
                }
            }
        );
        
        if (result.modifiedCount === 0) {
            logger.warn(`No user found with userId: ${userId}`);
            throw new Error('User not found');
        }
        
        return true;
    }

    static async storeReferralUsage(newUser, referrerUserId) {
        // Vérification anti-auto-référencement
        if (newUser.from.id.toString() === referrerUserId) {
            logger.warn(`Self-referral attempt detected for userId: ${referrerUserId}`);
            throw new Error('Self-referral is not allowed');
        }

        const collection = await this.getCollection();
        const newUserId = newUser.from.id.toString();
        
        // Vérifier si l'utilisateur existe déjà avec un parrain
        const existingUser = await collection.findOne({ userId: newUserId });
        if (existingUser && existingUser.referredBy) {
            logger.warn(`User ${newUserId} already has a referrer: ${existingUser.referredBy}`);
            throw new Error('User already has a referrer');
        }
    
        // Mettre à jour les informations de l'utilisateur
        await collection.updateOne(
            { userId: newUserId },
            { 
                $set: { 
                    referredBy: referrerUserId,
                    username: (newUser.from.username || '').toLowerCase(),
                    chatId: newUser.chat.id.toString(),
                    lastUpdated: new Date()
                }
            },
            { upsert: true }
        );
    
        // Incrémenter le nombre de clics pour le parrain
        await collection.updateOne(
            { userId: referrerUserId },
            { 
                $inc: { referralClicks: 1 },
                $set: { lastUpdated: new Date() }
            }
        );
    }

    static async recordReferralConversion(userId) {
        const collection = await this.getCollection();
        const user = await collection.findOne({ userId });
    
        if (user && user.referredBy) {
            await collection.updateOne(
                { userId: user.referredBy },
                { 
                    $inc: { referralConversions: 1 },
                    $addToSet: { referredUsers: user.username },
                    $set: { lastUpdated: new Date() }
                }
            );
        }
    }

    static async getReferredUsers(userId) {
        const collection = await this.getCollection();
        
        const user = await collection.findOne(
            { userId },
            { projection: { referredUsers: 1, referralConversions: 1 } }
        );

        return {
            referredUsers: user?.referredUsers || [],
            totalReferredUsers: user?.referralConversions || 0
        };
    }

    static async processReferralReward(userId, amount) {
        const collection = await this.getCollection();
        
        const user = await collection.findOne({ userId });
        
        if (user && user.referredBy) {
            if (user.referredBy === userId) {
                logger.error(`Self-referral reward attempt detected for userId: ${userId}`);
                return null;
            }

            const referrer = await collection.findOne({ userId: user.referredBy });
            
            if (referrer) {
                const referralReward = amount * 0.1;

                await collection.updateOne(
                    { userId: user.referredBy },
                    { 
                        $inc: { 
                            unclaimedRewards: referralReward
                        },
                        $set: { lastUpdated: new Date() }
                    }
                );

                logger.info(`Referral reward processed: ${referralReward} SOL for user ${referrer.userId}`);
                
                return {
                    referrerUserId: referrer.userId,
                    referralReward
                };
            }
        }

        return null;
    }

    static async getDetailedReferralStats(userId) {
        const collection = await this.getCollection();
        
        const user = await collection.findOne(
            { userId },
            { 
                projection: { 
                    referralClicks: 1,
                    referralConversions: 1,
                    referredUsers: 1,
                    unclaimedRewards: 1,
                    claimedRewards: 1,
                    referralWallet: 1,
                    username: 1,
                    chatId: 1
                }
            }
        );

        if (!user) return null;

        return {
            userId: user.userId,
            chatId: user.chatId,
            username: user.username,
            totalClicks: user.referralClicks,
            totalConversions: user.referralConversions,
            referredUsers: user.referredUsers,
            unclaimedRewards: user.unclaimedRewards,
            claimedRewards: user.claimedRewards,
            referralWallet: user.referralWallet
        };
    }

    static async validateReferral(userId) {
        const collection = await this.getCollection();
        
        const user = await collection.findOne({ userId });
        
        if (user && user.referredBy && !user.referralUsed) {
            await collection.updateOne(
                { userId },
                { 
                    $set: { 
                        referralUsed: true,
                        lastUpdated: new Date()
                    }
                }
            );
    
            await collection.updateOne(
                { userId: user.referredBy },
                { 
                    $inc: { referralCount: 1 },
                    $set: { lastUpdated: new Date() }
                }
            );
    
            return user.referredBy;
        }
    
        return null;
    }

    static async claimRewards(userId) {
        const collection = await this.getCollection();
        const user = await collection.findOne({ userId });
    
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
            { userId },
            {
                $inc: { claimedRewards: claimedAmount },
                $set: { 
                    unclaimedRewards: 0,
                    lastUpdated: new Date() 
                }
            }
        );
    
        logger.info(`User ${userId} claimed ${claimedAmount} SOL from referrals`);
        return { success: true, claimedAmount };
    }

    static async getAllReferrers() {
        const collection = await this.getCollection();
        return await collection.find(
            { referralConversions: { $gt: 0 } },
            { 
                projection: { 
                    userId: 1,
                    username: 1, 
                    referralConversions: 1, 
                    referredUsers: 1,
                    unclaimedRewards: 1
                }
            }
        ).toArray();
    }

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