const { getDatabase } = require('../config/connection');
const logger = require('../../utils/logger');

class PaymentService {
    static async savePaymentAddress(paymentData) {
        const database = await getDatabase();
        const collection = database.collection("payment_addresses");
        
        const paymentAddressData = {
            sessionId: paymentData.sessionId,
            chatId: paymentData.chatId,
            username: paymentData.username,
            publicKey: paymentData.paymentAddress,
            privateKey: Buffer.from(paymentData.privateKey).toString('base64'),
            amount: paymentData.amount,
            duration: paymentData.duration,
            created: paymentData.created,
            expires: paymentData.expires,
            status: paymentData.status,
            lastUpdated: new Date()
        };

        try {
            return await collection.insertOne(paymentAddressData);
        } catch (error) {
            logger.error(`Error saving payment address for session ${paymentData.sessionId}:`, error);
            throw error;
        }
    }

    static async getPaymentAddress(sessionId) {
        const database = await getDatabase();
        try {
            return await database.collection("payment_addresses").findOne({ sessionId });
        } catch (error) {
            logger.error(`Error retrieving payment for session ${sessionId}:`, error);
            return null;
        }
    }

    static async updatePaymentAddressStatus(sessionId, status) {
        const database = await getDatabase();
        try {
            return await database.collection("payment_addresses").updateOne(
                { sessionId },
                { $set: { status, lastUpdated: new Date() } }
            );
        } catch (error) {
            logger.error(`Error updating payment status for session ${sessionId}:`, error);
            return false;
        }
    }

    static async cleanupExpiredPaymentAddresses() {
        const database = await getDatabase();
        try {
            return await database.collection("payment_addresses").updateMany(
                { expires: { $lt: new Date() }, status: 'pending' },
                { $set: { status: 'expired', lastUpdated: new Date() } }
            );
        } catch (error) {
            logger.error('Error cleaning up expired payment addresses:', error);
            return 0;
        }
    }
}

module.exports = PaymentService;