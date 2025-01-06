const Joi = require('joi');

// Schema for individual payment records
const paymentRecordSchema = Joi.object({
    paymentId: Joi.string().required(),
    duration: Joi.string().valid('1month', '3month', '6month').required(),
    paymentDate: Joi.date().default(Date.now),
    paymentStatus: Joi.string().valid('pending', 'completed', 'failed').default('completed'),
    amount: Joi.number().optional()
});

// Main subscription schema
const subscriptionSchema = Joi.object({
    username: Joi.string().required(),
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
    '1month': 30 * 24 * 60 * 60 * 1000,   // 30 jours
    '3month': 90 * 24 * 60 * 60 * 1000,   // 90 jours
    '6month': 180 * 24 * 60 * 60 * 1000   // 180 jours
};

// Configuration du plan d'abonnement
const subscriptionPlan = {
    name: 'Standard',
    features: [
        'Access to all commands',
        'Priority support'
    ],
    prices: {
        '1month': 10,
        '3month': 25,
        '6month': 45
    }
};

module.exports = {
    validateSubscription,
    subscriptionDurations,
    subscriptionPlan
};