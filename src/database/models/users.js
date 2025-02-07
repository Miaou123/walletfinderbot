const Joi = require('joi');

const userSchema = Joi.object({
   userId: Joi.string().required(), 
   chatId: Joi.string().required(),
   username: Joi.string().required(),
   referralWallet: Joi.string().allow(''),
   referralLink: Joi.string().uri().allow(''),
   unclaimedRewards: Joi.number().default(0),
   claimedRewards: Joi.number().default(0),
   totalRewards: Joi.number().default(0),   
   referralClicks: Joi.number().default(0),
   referralConversions: Joi.number().default(0),
   referredBy: Joi.string().allow(null).default(null).custom((value, helpers) => {
      const user = helpers.state.ancestors[0];
      if (value === user.chatId) {
          return helpers.error('any.invalid');
      }
      return value;
   }, 'validate self-referral'),
   referredUsers: Joi.array().items(Joi.string()).default([]),
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