const { connectToDatabase, getDatabase } = require('./config/connection');
const WalletService = require('./services/walletService');
const UserService = require('./services/userService');
const SubscriptionService = require('./services/subscriptionService');
const PaymentService = require('./services/paymentService');
const TokenVerificationService = require('./services/tokenVerificationService');
const SubscriptionConfig = require('./config/subscriptionConfig');
const VerifiedUser = require('./models/verified_user');
const VerifiedGroup = require('./models/verified_group');


// Pour la compatibilité avec le code existant
module.exports = {
    connectToDatabase,
    getDatabase,
    // Méthodes de compatibilité
    saveInterestingWallet: WalletService.saveInterestingWallet,
    createOrUpdateSubscription: SubscriptionService.createOrUpdateSubscription,
    checkSubscription: SubscriptionService.checkSubscription,
    getSubscription: SubscriptionService.getSubscription,
    completeSubscriptionPayment: SubscriptionService.completeSubscriptionPayment,
    savePaymentAddress: PaymentService.savePaymentAddress,
    getPaymentAddress: PaymentService.getPaymentAddress,
    updatePaymentAddressStatus: PaymentService.updatePaymentAddressStatus,
    cleanupExpiredPaymentAddresses: PaymentService.cleanupExpiredPaymentAddresses,
    createOrUpdateGroupSubscription: SubscriptionService.createOrUpdateGroupSubscription,
    getGroupSubscription: SubscriptionService.getGroupSubscription,
    updateGroupSubscriptionPayment: SubscriptionService.updateGroupSubscriptionPayment,
    createOrUpdateUser: UserService.createOrUpdateUser,
    getUserByReferralCode: UserService.getUserByReferralCode,
    updateReferralStats: UserService.updateReferralStats,
    // Services
    WalletService,
    UserService,
    SubscriptionService,
    PaymentService,
    SubscriptionConfig, 
    TokenVerificationService,
    VerifiedUser,
    VerifiedGroup
};