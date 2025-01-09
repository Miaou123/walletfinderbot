const Joi = require('joi');

// Schema for group payment records (similaire à user payment records)
const groupPaymentRecordSchema = Joi.object({
    paymentId: Joi.string().required(),
    duration: Joi.string().valid('1month').required(), // Uniquement 1 mois pour les groupes
    paymentDate: Joi.date().default(Date.now),
    paymentStatus: Joi.string().valid('pending', 'completed', 'failed').default('completed'),
    amount: Joi.number().default(2.0), // 2 SOL fixe pour les groupes
    transactionHash: Joi.string().optional(),
    transferHash: Joi.string().optional(),
    paidByUserId: Joi.string().required(), // ID Telegram de l'admin qui a payé
    paidByUsername: Joi.string().required() // Username de l'admin qui a payé
});

// Main group subscription schema
const groupSubscriptionSchema = Joi.object({
    groupId: Joi.string().required(), // ID Telegram du groupe
    groupName: Joi.string().required(), // Nom du groupe
    startDate: Joi.date().default(Date.now),
    expiresAt: Joi.date().greater('now').required(),
    active: Joi.boolean().default(true),
    lastUpdated: Joi.date().default(Date.now),
    paymentHistory: Joi.array().items(groupPaymentRecordSchema).default([])
});

function validateGroupSubscription(subscription) {
    const { error, value } = groupSubscriptionSchema.validate(subscription, {
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

// Durée d'abonnement pour les groupes (uniquement 1 mois)
const groupSubscriptionDurations = {
    '1month': 30 * 24 * 60 * 60 * 1000 // 30 jours
};

// Prix d'abonnement pour les groupes
const groupSubscriptionPlan = {
    name: 'Group Plan',
    features: [
        'Access to all commands for all group members',
        'Priority support',
        '24/7 bot availability'
    ],
    prices: {
        '1month': 2.0 // 2 SOL par mois
    }
};

module.exports = {
    validateGroupSubscription,
    groupSubscriptionDurations,
    groupSubscriptionPlan,
    groupPaymentRecordSchema,
    groupSubscriptionSchema
};