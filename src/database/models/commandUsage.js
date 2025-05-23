const Joi = require('joi');

const commandUsageSchema = Joi.object({
    command: Joi.string().required(),
    totalUsage: Joi.number().default(0),
    lastUsed: Joi.date().default(Date.now),
    userUsage: Joi.object().pattern(
        Joi.string(), // userId
        Joi.object({
            count: Joi.number().default(0),
            lastUsed: Joi.date().default(Date.now),
            username: Joi.string().allow(null, '')
        })
    ).default({}),
    dailyStats: Joi.array().items(
        Joi.object({
            date: Joi.string().required(), // YYYY-MM-DD format
            count: Joi.number().default(0),
            uniqueUsers: Joi.number().default(0)
        })
    ).default([]),
    createdAt: Joi.date().default(Date.now),
    lastUpdated: Joi.date().default(Date.now)
});

function validateCommandUsage(usage) {
    return commandUsageSchema.validate(usage, {
        abortEarly: false,
        stripUnknown: true,
        convert: true
    });
}

module.exports = { validateCommandUsage };