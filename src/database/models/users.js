const Joi = require('joi');

const userSchema = Joi.object({
   chatId: Joi.string().required(),
   username: Joi.string().required(),
   referralWallet: Joi.string().allow(''),
   unclaimedRewards: Joi.number().default(0),
   claimedRewards: Joi.number().default(0),
   referralCount: Joi.number().default(0), // Nombre d'utilisations validées
   referralClicks: Joi.number().default(0), // Nombre de clics sur le lien
   referredBy: Joi.string().allow(null).default(null),
   referralUsed: Joi.boolean().default(false),
   lastUpdated: Joi.date().default(Date.now)
});

function validateUser(user) {
   return userSchema.validate(user, {
       abortEarly: false,
       stripUnknown: true,
       convert: true
   });
}

module.exports = { validateUser };