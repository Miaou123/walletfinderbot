const { getDatabase } = require('../config/connection');
const { validatePaymentData, validateStatusUpdate } = require('../models/paymentReceipt');
const logger = require('../../utils/logger');

const COLLECTION_NAME = 'paymentReceipt';

class PaymentService {
    static async getCollection() {
        const db = await getDatabase();
        return db.collection(COLLECTION_NAME);
    }

    static async savePaymentAddress(paymentData) {
        try {
            const collection = await this.getCollection();
            
            // S'assurer que userId est présent dans les données
            if (!paymentData.userId) {
                throw new Error('userId is required in payment data');
            }

            // Ajout du userId aux données de paiement
            const paymentDataWithUser = {
                ...paymentData,
                lastUpdated: new Date()
            };
            
            // Étape 1 : Validation des données avec Joi
            const validatedData = validatePaymentData(paymentDataWithUser);

            // Étape 2 : Sauvegarder les données validées
            const result = await collection.insertOne(validatedData);

            return result;
        } catch (error) {
            logger.error(`Error saving payment address for user ${paymentData.userId}, session ${paymentData.sessionId}:`, error);
            throw error;
        }
    }

    static async getPaymentAddress(sessionId) {
        try {
            const collection = await this.getCollection();
            const paymentAddress = await collection.findOne({ sessionId });
            return paymentAddress;
        } catch (error) {
            logger.error(`Error retrieving payment for session ${sessionId}:`, error);
            return null;
        }
    }

    static async getPaymentsByUserId(userId) {
        try {
            const collection = await this.getCollection();
            return await collection.find({ userId }).toArray();
        } catch (error) {
            logger.error(`Error retrieving payments for user ${userId}:`, error);
            return [];
        }
    }

    static async updatePaymentAddressStatus(sessionId, status, userId) {
        try {
            const collection = await this.getCollection();
    
            if (!status) {
                throw new Error('Status is required for updating payment address');
            }
    
            const updateData = {
                status, 
                lastUpdated: new Date()
            };
    
            const result = await collection.updateOne(
                { sessionId, userId },  // Ajouter userId dans la condition
                { $set: updateData }
            );
    
            if (result.matchedCount === 0) {
                logger.warn(`No document found with sessionId: ${sessionId} for user: ${userId}`);
                return false;
            }
    
            if (result.modifiedCount === 0) {
                logger.warn(`Document with sessionId: ${sessionId} for user: ${userId} was not updated (possibly no changes).`);
                return false;
            }
    
            logger.info(`Successfully updated status for sessionId: ${sessionId}, user: ${userId} to '${status}'.`);
            return true;
        } catch (error) {
            logger.error(`Error updating payment status for session ${sessionId}, user ${userId}:`, error);
            throw error;
        }
    }
    
    static async cleanupExpiredPaymentAddresses() {
        try {
            const collection = await this.getCollection();
            
            const result = await collection.updateMany(
                { expiresAt: { $lt: new Date() }, status: 'pending' },
                { $set: { status: 'expired', lastUpdated: new Date() } }
            );

            logger.info(`Cleaned up ${result.modifiedCount} expired payment addresses`);
            return result;
        } catch (error) {
            logger.error('Error cleaning up expired payment addresses:', error);
            return 0;
        }
    }

    static async getPendingPayments(userId) {
        try {
            const collection = await this.getCollection();
            return await collection.find({
                userId,
                status: 'pending',
                expiresAt: { $gt: new Date() }
            }).toArray();
        } catch (error) {
            logger.error(`Error retrieving pending payments for user ${userId}:`, error);
            return [];
        }
    }
}

module.exports = PaymentService;