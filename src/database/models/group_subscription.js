const { schemas } = require('../config/subscriptionConfig');

module.exports = {
    validateGroupSubscription: schemas.group.validate,
    groupSubscriptionDuration: schemas.group.duration,
    groupSubscriptionPrice: schemas.group.price
};