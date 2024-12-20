const Joi = require('joi');

const walletSchema = Joi.object({
    // Champs obligatoires
    address: Joi.string().required(),
    refresh_date: Joi.date().required(),
    lastUpdated: Joi.date().required(),

    // Champs optionnels avec possibilité de null/undefined/false
    winrate: Joi.alternatives().try(
        Joi.number(),
        Joi.valid(null, false)
    ).default(null),
    realized_profit_30d: Joi.alternatives().try(
        Joi.number(),
        Joi.valid(null, false)
    ).default(null),
    twitter_bind: Joi.alternatives().try(
        Joi.string(),
        Joi.valid(null, '', false)
    ).default(null),
    portfolio_value: Joi.alternatives().try(
        Joi.number(),
        Joi.valid(null, false)
    ).default(null),
    sol_balance: Joi.alternatives().try(
        Joi.number(),
        Joi.valid(null, false)
    ).default(null),
    trades_count: Joi.alternatives().try(
        Joi.number(),
        Joi.valid(null, false)
    ).default(null),
    profit_trades: Joi.alternatives().try(
        Joi.number(),
        Joi.valid(null, false)
    ).default(null),
    loss_trades: Joi.alternatives().try(
        Joi.number(),
        Joi.valid(null, false)
    ).default(null),
    total_volume_30d: Joi.alternatives().try(
        Joi.number(),
        Joi.valid(null, false)
    ).default(null),
    average_holding_time: Joi.alternatives().try(
        Joi.number(),
        Joi.valid(null, false)
    ).default(null),
    last_trade_date: Joi.alternatives().try(
        Joi.date(),
        Joi.valid(null, false)
    ).default(null),
    tags: Joi.alternatives().try(
        Joi.array().items(Joi.string()),
        Joi.valid(null, false)
    ).default([]),
}).unknown(true);

function validateWallet(wallet) {
    // Nettoyer les données avant la validation
    const sanitizedWallet = Object.fromEntries(
        Object.entries(wallet).map(([key, value]) => {
            // Convertir undefined en null
            if (value === undefined) return [key, null];
            // Convertir false en null pour certains champs spécifiques
            if (value === false && ['twitter_bind', 'winrate', 'realized_profit_30d'].includes(key)) {
                return [key, null];
            }
            return [key, value];
        })
    );

    return walletSchema.validate(sanitizedWallet, { 
        abortEarly: false,
        stripUnknown: false,
        convert: true
    });
}

module.exports = { validateWallet };