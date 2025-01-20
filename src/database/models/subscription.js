const Joi = require('joi');

// Schema for individual payment records
const paymentRecordSchema = Joi.object({
    paymentId: Joi.string().required(),
    duration: Joi.string().valid('1month', '3month', '6month').required(),
    paymentDate: Joi.date().default(Date.now),
    paymentStatus: Joi.string().valid('pending', 'completed', 'failed').default('completed'),
    amount: Joi.number().optional(),
    transactionHash: Joi.string().optional(),
    transferHash: Joi.string().optional()  
});

// Main subscription schema
const subscriptionSchema = Joi.object({
    chatId: Joi.string().required(),
    username: Joi.string().optional(), // Gardé en option pour la rétrocompatibilité
    startDate: Joi.date().default(Date.now),
    expiresAt: Joi.date().greater('now').required(),
    active: Joi.boolean().default(true),
    lastUpdated: Joi.date().default(Date.now),
    paymentHistory: Joi.array().items(paymentRecordSchema).default([])
});

function validateSubscription(subscription) {
    const { error, value } = subscriptionSchema.validate(subscription, {
        abortEarly: false,
        stripUnknown: true,
        convert: true
    });

    if (error) {
        return {
            error: error,
            value: subscription
        };
    }

    return {
        error: null,
        value: value
    };
}

// Durées des abonnements en millisecondes
const subscriptionDurations = {
    '1month': 30 * 24 * 60 * 60 * 1000, // 30 jours
    '3month': 90 * 24 * 60 * 60 * 1000, // 90 jours
    '6month': 180 * 24 * 60 * 60 * 1000 // 180 jours
};

const subscriptionPlan = {
    name: 'Basic Plan',
    features: [
        'Access to all commands',
        'Monthly subscription',
        'Priority support'
    ],
    price: 0.5 // 0.5 SOL par mois
};

module.exports = {
    validateSubscription,
    subscriptionDurations,
    subscriptionPlan
};