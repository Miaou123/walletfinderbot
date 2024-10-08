const Joi = require('joi');

const walletSchema = Joi.object({
    address: Joi.string().required(),
    balance: Joi.number().min(0).required(),
    total_value: Joi.number().min(0).required(),
    realized_profit_30d: Joi.number().required(),
    winrate: Joi.number().min(0).max(1).required(),
    buy_30d: Joi.number().integer().min(0).required(),
    token_avg_cost: Joi.number().min(0).required(),
    token_sold_avg_profit: Joi.number().required(),
    pnl_2x_5x_num: Joi.number().integer().min(0).required(),
    pnl_gt_5x_num: Joi.number().integer().min(0).required(),
    lastUpdated: Joi.date().required()
});

function validateWallet(wallet) {
    return walletSchema.validate(wallet);
}

module.exports = { validateWallet };