// src/database/models/subscription.js
const { schemas } = require('../config/subscriptionConfig');

module.exports = {
    validateSubscription: schemas.user.validate,
    subscriptionDuration: schemas.user.duration,
    subscriptionPrice: schemas.user.price
};