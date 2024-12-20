const Joi = require('joi');

const subscriptionTypes = ['basic', 'vip'];

const subscriptionSchema = Joi.object({
    userId: Joi.string().required(),
    username: Joi.string().required(),
    type: Joi.string().valid(...subscriptionTypes).required(),
    startDate: Joi.date().default(Date.now),
    expiresAt: Joi.date().greater('now').required(),
    active: Joi.boolean().default(true),
    lastUpdated: Joi.date().default(Date.now),
    paymentId: Joi.string().optional(),
    paymentStatus: Joi.string().valid('pending', 'completed', 'failed').default('pending'),
    duration: Joi.string().valid('1month', '3month', '6month').required(),
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

// Configuration des plans d'abonnement
const subscriptionPlans = {
    basic: {
        name: 'Basic',
        features: [
            'Accès aux commandes de base',
            'Support standard'
        ],
        prices: {
            '1month': 10,
            '3month': 25,
            '6month': 45
        }
    },
    vip: {
        name: 'VIP',
        features: [
            'Accès à toutes les commandes',
            'Support prioritaire',
            'Fonctionnalités exclusives'
        ],
        prices: {
            '1month': 20,
            '3month': 50,
            '6month': 90
        }
    }
};

module.exports = {
    validateSubscription,
    subscriptionTypes,
    subscriptionDurations,
    subscriptionPlans
};