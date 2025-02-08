const Joi = require('joi');
const logger = require('../../utils/logger.js');

const walletSchema = Joi.object({
    // Champs obligatoires
    address: Joi.string().required(),
    refresh_date: Joi.date().required(),
    lastUpdated: Joi.date().required(),

    // Données de base
    twitter_bind: Joi.boolean().allow(null),
    twitter_fans_num: Joi.number().allow(null),
    twitter_username: Joi.string().allow(null, ''),
    twitter_name: Joi.string().allow(null, ''),
    ens: Joi.string().allow(null, ''),
    avatar: Joi.string().allow(null, ''),
    name: Joi.string().allow(null, ''),

    // Balances
    eth_balance: Joi.string().allow(null),
    sol_balance: Joi.string().allow(null),
    trx_balance: Joi.string().allow(null),
    balance: Joi.string().allow(null),

    // Données financières
    total_value: Joi.number().allow(null),
    unrealized_profit: Joi.number().allow(null),
    unrealized_pnl: Joi.number().allow(null),
    realized_profit: Joi.number().allow(null),
    pnl: Joi.number().allow(null),
    pnl_1d: Joi.number().allow(null),
    pnl_7d: Joi.number().allow(null),
    pnl_30d: Joi.number().allow(null),
    realized_profit_1d: Joi.number().allow(null),
    realized_profit_7d: Joi.number().allow(null),
    realized_profit_30d: Joi.number().allow(null),
    winrate: Joi.number().allow(null),
    all_pnl: Joi.number().allow(null),
    total_profit: Joi.number().allow(null),
    total_profit_pnl: Joi.number().allow(null),

    // Transactions
    buy_1d: Joi.number().allow(null),
    sell_1d: Joi.number().allow(null),
    buy_30d: Joi.number().allow(null),
    sell_30d: Joi.number().allow(null),
    buy_7d: Joi.number().allow(null),
    sell_7d: Joi.number().allow(null),
    buy: Joi.number().allow(null),
    sell: Joi.number().allow(null),

    // Métriques token
    history_bought_cost: Joi.number().allow(null),
    token_avg_cost: Joi.number().allow(null),
    token_sold_avg_profit: Joi.number().allow(null),
    token_num: Joi.number().allow(null),
    profit_num: Joi.number().allow(null),

    // Métriques PnL
    pnl_lt_minus_dot5_num: Joi.number().allow(null),
    pnl_minus_dot5_0x_num: Joi.number().allow(null),
    pnl_lt_2x_num: Joi.number().allow(null),
    pnl_2x_5x_num: Joi.number().allow(null),
    pnl_gt_5x_num: Joi.number().allow(null),

    // Timestamps et activité
    last_active_timestamp: Joi.number().allow(null),
    updated_at: Joi.number().allow(null),
    refresh_requested_at: Joi.number().allow(null),
    avg_holding_peroid: Joi.number().allow(null),

    // Tags et analyse
    tags: Joi.array().items(Joi.string()).allow(null),
    tag_rank: Joi.object().allow(null),
    followers_count: Joi.number().allow(null),
    is_contract: Joi.boolean().allow(null),

    // Données de risque
    risk: Joi.object({
        token_active: Joi.string().allow(null),
        token_honeypot: Joi.string().allow(null),
        token_honeypot_ratio: Joi.number().allow(null),
        no_buy_hold: Joi.string().allow(null),
        no_buy_hold_ratio: Joi.number().allow(null),
        sell_pass_buy: Joi.string().allow(null),
        sell_pass_buy_ratio: Joi.number().allow(null),
        fast_tx: Joi.string().allow(null),
        fast_tx_ratio: Joi.number().allow(null)
    }).allow(null)
}).unknown(true);

function validateWallet(wallet) {
    // Nettoyer les données avant la validation
    const sanitizedWallet = Object.fromEntries(
        Object.entries(wallet).map(([key, value]) => {
            // Convertir undefined, '', et null en null
            if (value === undefined || value === '' || value === null) {
                return [key, null];
            }

            // Convertir les balances en string
            if (['eth_balance', 'sol_balance', 'trx_balance', 'balance'].includes(key) && value !== null) {
                return [key, value.toString()];
            }

            // Convertir les "false" string en boolean false
            if (value === 'false') {
                return [key, false];
            }

            // Convertir les "true" string en boolean true
            if (value === 'true') {
                return [key, true];
            }

            // Pour les nombres stockés comme strings, essayer de les convertir
            if (typeof value === 'string' && !isNaN(value) && key !== 'address' && !['eth_balance', 'sol_balance', 'trx_balance', 'balance'].includes(key)) {
                return [key, Number(value)];
            }

            // Cas spécial pour certains champs booléens
            if (value === false && ['twitter_bind', 'is_contract'].includes(key)) {
                return [key, false];
            }

            return [key, value];
        })
    );

    // On fait la validation avec des options permissives
    const validationResult = walletSchema.validate(sanitizedWallet, { 
        abortEarly: false, // Continue la validation même après avoir trouvé des erreurs
        stripUnknown: true, // Enlève les champs inconnus
        convert: true, // Permet la conversion automatique des types
        allowUnknown: true, // Permet des champs supplémentaires
        presence: 'optional' // Tous les champs sont optionnels sauf ceux marqués comme required
    });

    // Si on a des erreurs de validation, on les log mais on ne bloque pas
    if (validationResult.error) {
        logger.debug('Validation warnings for wallet:', {
            address: wallet.address,
            warnings: validationResult.error.details.map(d => d.message)
        });
    }

    return {
        value: validationResult.value,
        error: null // On retourne toujours null pour l'erreur pour ne pas bloquer la sauvegarde
    };
}

module.exports = { validateWallet };