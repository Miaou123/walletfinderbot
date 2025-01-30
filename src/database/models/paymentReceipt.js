const Joi = require('joi');

// Schéma de validation pour les adresses de paiement
const paymentReceiptSchema = Joi.object({
    sessionId: Joi.string().required(),
    userId: Joi.string().required(), 
    chatId: Joi.string().required(),
    username: Joi.string().required(),
    paymentAddress: Joi.string().required(),
    privateKey: Joi.string().required(),
    baseAmount: Joi.number().required(),
    finalAmount: Joi.number().required(),
    referralLinkUsed: Joi.boolean().default(false),
    duration: Joi.string().required(),
    createdAt: Joi.date().default(() => new Date()), // Défaut avec une fonction valide
    expiresAt: Joi.date().required(),
    status: Joi.string().valid('pending', 'completed', 'expired').default('pending'),
    lastUpdated: Joi.date().default(() => new Date()), // Défaut avec une fonction valide
});

// Fonction pour valider les données

const updateStatusSchema = Joi.object({
    sessionId: Joi.string().required(),
    status: Joi.string().valid('pending', 'completed', 'expired').required(),
    lastUpdated: Joi.date().default(() => new Date())
});

const validatePaymentData = (data) => {
    const { error, value } = paymentReceiptSchema.validate(data, { abortEarly: false });
    if (error) {
        throw new Error(`Validation error: ${error.details.map((e) => e.message).join(', ')}`);
    }
    return value; 
};


const validateStatusUpdate = (data) => {
    const { error, value } = updateStatusSchema.validate(data, { abortEarly: false });
    if (error) {
        throw new Error(`Validation error: ${error.details.map((e) => e.message).join(', ')}`);
    }
    return value;
};

module.exports = { validatePaymentData, validateStatusUpdate };
