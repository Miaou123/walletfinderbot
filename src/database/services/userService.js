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

        const referralLink = this.generateReferralLink(username);
    
        const userData = {
            chatId,
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
                { chatId },
                { $set: value },
                { upsert: true, returnDocument: 'after' }
            );
    
            return result.value || value;
        } catch (err) {
            // Gestion spécifique des erreurs de duplicate key
            if (err.code === 11000) {
                logger.warn(`Duplicate key error for user with chatId ${chatId}`);
                // Récupérer l'utilisateur existant
                return await this.getUserByChatId(chatId);
            }
            throw err;
        }
    }

    static async getUser(username) {
        const collection = await this.getCollection();
        return collection.findOne({ username });
    }

    static async getUserByChatId(chatId) {
        const collection = await this.getCollection();
        return collection.findOne({ chatId });
    }

    static generateReferralLink(username) {
        return `https://t.me/Noesis_local_bot?start=r-${username}`;
    }

    static async saveReferralLink(chatId, username) {
        const collection = await this.getCollection();
        const referralLink = this.generateReferralLink(username);
    
        await collection.updateOne(
            { chatId },  // Utiliser chatId au lieu de username
            { 
                $set: { 
                    referralLink: referralLink,
                    lastUpdated: new Date() 
                }
            },
            { upsert: true }
        );
    
        return referralLink;
    }

    static async getUsernameFromChatId(chatId) {
        const collection = await this.getCollection();
        const user = await collection.findOne({ chatId }, { projection: { username: 1 } });
        return user ? user.username : null;
    }

    static async addUnclaimedRewards(chatId, amount) {
        const collection = await this.getCollection();
        await collection.updateOne(
            { chatId },
            { 
                $inc: { unclaimedRewards: amount },
                $set: { lastUpdated: new Date() }
            }
        );
    }

    static async isValidReferralLink(referralLink) {
        const collection = await this.getCollection();
        const user = await collection.findOne({ referralLink: referralLink });
        return !!user;
    }

    static async getReferralLink(chatId, username) {
        const collection = await this.getCollection();
        const user = await collection.findOne(
            { chatId },
            { projection: { referralLink: 1 } }
        );
    
        return user?.referralLink || this.generateReferralLink(username);
    }

    static async setReferralWallet(chatId, wallet) {
        const collection = await this.getCollection();
        const result = await collection.updateOne(
            { chatId },
            { 
                $set: { 
                    referralWallet: wallet, 
                    lastUpdated: new Date() 
                }
            }
        );
        
        if (result.modifiedCount === 0) {
            logger.warn(`No user found with chatId: ${chatId}`);
            throw new Error('User not found');
        }
        
        return true;
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

    static async storeReferralUsage(newChatId, newUsername, referrerChatId) {
        const collection = await this.getCollection();
    
        // Mettre à jour les informations de l'utilisateur
        await collection.updateOne(
            { chatId: newChatId },
            { 
                $set: { 
                    referredBy: referrerChatId,
                    username: newUsername,
                    lastUpdated: new Date()
                }
            },
            { upsert: true }
        );
    
        // Incrémenter seulement le nombre de clics pour le parrain
        await collection.updateOne(
            { chatId: referrerChatId },
            { 
                $inc: { referralClicks: 1 },
                $set: { lastUpdated: new Date() }
            }
        );
    }

    static async recordReferralConversion(chatId) {
        const collection = await this.getCollection();
        const user = await collection.findOne({ chatId });
    
        if (user && user.referredBy) {
            await collection.updateOne(
                { chatId: user.referredBy },
                { 
                    $inc: { referralConversions: 1 },
                    $addToSet: { referredUsers: user.username },
                    $set: { lastUpdated: new Date() }
                }
            );
        }
    }

    // Method to get referred users for a specific user
    static async getReferredUsers(chatId) {
        const collection = await this.getCollection();
        
        const user = await collection.findOne(
            { chatId },
            { projection: { referredUsers: 1, referralConversions: 1 } }
        );

        return {
            referredUsers: user?.referredUsers || [],
            totalReferredUsers: user?.referralConversions || 0
        };
    }

    // Method to process referral reward with additional tracking
    static async processReferralReward(newChatId, amount) {
        const collection = await this.getCollection();
        
        const user = await collection.findOne({ chatId: newChatId });
        
        if (user && user.referredBy) {
            const referrer = await collection.findOne({ chatId: user.referredBy });
            
            if (referrer) {
                const referralReward = amount * 0.1;

                await collection.updateOne(
                    { chatId: user.referredBy },
                    { 
                        $inc: { 
                            unclaimedRewards: referralReward
                        },
                        $set: { lastUpdated: new Date() }
                    }
                );

                logger.info(`Referral reward processed: ${referralReward} SOL for ${referrer.chatId}`);
                
                return {
                    referrerChatId: referrer.chatId,
                    referralReward
                };
            }
        }

        return null;
    }

     // Method to get detailed referral stats
     static async getDetailedReferralStats(chatId) {
        const collection = await this.getCollection();
        
        const user = await collection.findOne(
            { chatId },
            { 
                projection: { 
                    referralClicks: 1,
                    referralConversions: 1,
                    referredUsers: 1,
                    unclaimedRewards: 1,
                    claimedRewards: 1,
                    referralWallet: 1,
                    username: 1
                }
            }
        );

        if (!user) return null;

        return {
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


    // Add a method to validate and count successful referrals
    static async validateReferral(chatId) {
        const collection = await this.getCollection();
        
        const user = await collection.findOne({ chatId });
        
        if (user && user.referredBy && !user.referralUsed) {
            // Mark this referral as used
            await collection.updateOne(
                { chatId },
                { 
                    $set: { 
                        referralUsed: true,
                        lastUpdated: new Date()
                    }
                }
            );
    
            // Increment referral count for the referrer
            await collection.updateOne(
                { chatId: user.referredBy },
                { 
                    $inc: { referralCount: 1 },
                    $set: { lastUpdated: new Date() }
                }
            );
    
            return user.referredBy;
        }
    
        return null;
    }

    static async validateReferral(chatId) {
        const collection = await this.getCollection();
        
        const user = await collection.findOne({ chatId });
        
        if (user && user.referredBy && !user.referralUsed) {
            // Mark this referral as used
            await collection.updateOne(
                { chatId },
                { 
                    $set: { 
                        referralUsed: true,
                        lastUpdated: new Date()
                    }
                }
            );
    
            // Increment referral count for the referrer
            await collection.updateOne(
                { chatId: user.referredBy },
                { 
                    $inc: { referralCount: 1 },
                    $set: { lastUpdated: new Date() }
                }
            );
    
            return user.referredBy;
        }
    
        return null;
    }

    static async claimRewards(chatId) {
        const collection = await this.getCollection();
        const user = await collection.findOne({ chatId });
    
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
            { chatId },
            {
                $inc: { claimedRewards: claimedAmount },
                $set: { 
                    unclaimedRewards: 0,
                    lastUpdated: new Date() 
                }
            }
        );
    
        logger.info(`User with chatId ${chatId} claimed ${claimedAmount} SOL from referrals`);
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

    // Update getAllReferrers to include more details
    static async getAllReferrers() {
        const collection = await this.getCollection();
        return await collection.find(
            { referralConversions: { $gt: 0 } },
            { 
                projection: { 
                    username: 1, 
                    referralConversions: 1, 
                    referredUsers: 1,
                    unclaimedRewards: 1
                }
            }
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