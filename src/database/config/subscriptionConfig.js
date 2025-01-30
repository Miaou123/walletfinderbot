// src/database/config/subscriptionConfig.js
const Joi = require('joi');

const SUBSCRIPTION_TYPES = {
    USER: {
        type: 'individual',
        duration: 30 * 24 * 60 * 60 * 1000, // 30 days in milliseconds
        price: 0.5, // SOL
        schemaName: 'user'
    },
    GROUP: {
        type: 'group',
        duration: 30 * 24 * 60 * 60 * 1000, // 30 days in milliseconds
        price: 2.0, // SOL
        schemaName: 'group'
    },
    REFERRAL: {
        discountPercent: 20, // 20% off for referred users
        referrerCredit: 0.1 // 0.1 SOL credit for each referral
    }
};

// Common payment record schema with type-specific extensions
const basePaymentRecordSchema = {
    paymentId: Joi.string().required(),
    userId: Joi.string().required(),
    duration: Joi.string().valid('1month').required(),
    paymentDate: Joi.date().default(Date.now),
    paymentStatus: Joi.string().valid('pending', 'completed', 'failed').default('completed'),
    amount: Joi.number().optional(),
    transactionHash: Joi.string().optional(),
    transferHash: Joi.string().optional(),
    referralCode: Joi.string().optional()
};

const userPaymentRecordSchema = Joi.object({
    ...basePaymentRecordSchema
});

const groupPaymentRecordSchema = Joi.object({
    ...basePaymentRecordSchema,
    paidByUserId: Joi.string().required(),
    paidByUsername: Joi.string().required()
});

// Base subscription schema with type-specific extensions
const baseSubscriptionSchema = {
    startDate: Joi.date().default(Date.now),
    expiresAt: Joi.date().greater('now').required(),
    active: Joi.boolean().default(true),
    lastUpdated: Joi.date().default(Date.now)
};

const userSubscriptionSchema = Joi.object({
    ...baseSubscriptionSchema,
    userId: Joi.string().required(),   
    chatId: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
    username: Joi.string().optional(),
    paymentHistory: Joi.array().items(userPaymentRecordSchema).default([]),
    referralCode: Joi.string().optional()
});

const groupSubscriptionSchema = Joi.object({
    ...baseSubscriptionSchema,
    chatId: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
    groupName: Joi.string().required(),
    adminUserId: Joi.string().required(),  
    paymentHistory: Joi.array().items(groupPaymentRecordSchema).default([])
});

function validateSubscription(subscription, type) {
    const schemas = {
        user: userSubscriptionSchema,
        group: groupSubscriptionSchema
    };

    const schema = schemas[type];
    if (!schema) {
        throw new Error(`Invalid subscription type: ${type}`);
    }

    return schema.validate(subscription, {
        abortEarly: false,
        stripUnknown: true,
        convert: true
    });
}

module.exports = {
    SUBSCRIPTION_TYPES,
    validateSubscription,
    schemas: {
        user: {
            validate: (subscription) => validateSubscription(subscription, 'user'),
            duration: SUBSCRIPTION_TYPES.USER.duration,
            price: SUBSCRIPTION_TYPES.USER.price
        },
        group: {
            validate: (subscription) => validateSubscription(subscription, 'group'),
            duration: SUBSCRIPTION_TYPES.GROUP.duration,
            price: SUBSCRIPTION_TYPES.GROUP.price
        }
    }
};