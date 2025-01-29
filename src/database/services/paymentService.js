const { getDatabase } = require('../config/connection');
const { validatePaymentData, validateStatusUpdate } = require('../models/paymentReceipt'); // Validation avec Joi
const logger = require('../../utils/logger');

const COLLECTION_NAME = 'paymentReceipt';

class PaymentService {

    static async getCollection() {
        const db = await getDatabase();
        return db.collection(COLLECTION_NAME);
    }
    // Sauvegarder une nouvelle adresse de paiement
    static async savePaymentAddress(paymentData) {
        try {
            const collection = await this.getCollection();
            
            // Étape 1 : Validation des données avec Joi
            const validatedData = validatePaymentData(paymentData);

            // Étape 2 : Sauvegarder les données validées dans la collection MongoDB
            const result = await collection.insertOne(validatedData);

            return result;
        } catch (error) {
            logger.error(`Error saving payment address for session ${paymentData.sessionId}:`, error);
            throw error;
        }
    }

    // Récupérer une adresse de paiement par sessionId
    static async getPaymentAddress(sessionId) {
        try {
            const db = getDatabase(); // Obtenez l'instance MongoDB
            
            const paymentAddress = await db.collection(collectionName).findOne({ sessionId });
            return paymentAddress;
        } catch (error) {
            logger.error(`Error retrieving payment for session ${sessionId}:`, error);
            return null;
        }
    }

    // Mettre à jour le statut d'une adresse de paiement
    static async updatePaymentAddressStatus(sessionId, status) {
        try {
            const collection = await this.getCollection();
    
            // Construisez les données de mise à jour en validant les champs nécessaires
            const updateData = {
                status, 
                lastUpdated: new Date()
            };
    
            // Vérifiez que `status` est bien défini et valide avant de faire l'update
            if (!status) {
                throw new Error('Status is required for updating payment address');
            }
    
            // Effectuez la mise à jour
            const result = await collection.updateOne(
                { sessionId },
                { $set: updateData }
            );
    
            if (result.matchedCount === 0) {
                logger.warn(`No document found with sessionId: ${sessionId}`);
                return false;
            }
    
            if (result.modifiedCount === 0) {
                logger.warn(`Document with sessionId: ${sessionId} was not updated (possibly no changes).`);
                return false;
            }
    
            logger.info(`Successfully updated status for sessionId: ${sessionId} to '${status}'.`);
            return true;
        } catch (error) {
            logger.error(`Error updating payment status for session ${sessionId}:`, error);
            throw error; // Renvoyer l'erreur pour un meilleur diagnostic
        }
    }
    
    
    // Nettoyer les adresses de paiement expirées
    static async cleanupExpiredPaymentAddresses() {
        try {
            const db = getDatabase(); // Obtenez l'instance MongoDB
            
            const result = await db.collection(collectionName).updateMany(
                { expiresAt: { $lt: new Date() }, status: 'pending' },
                { $set: { status: 'expired', lastUpdated: new Date() } }
            );

            return result;
        } catch (error) {
            logger.error('Error cleaning up expired payment addresses:', error);
            return 0;
        }
    }
}

module.exports = PaymentService;
