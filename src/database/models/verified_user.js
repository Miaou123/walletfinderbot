// models/verified_user.js
const { Schema, model } = require('mongoose');

/**
 * Schema for storing token-verified users
 */
const verifiedUserSchema = new Schema({
  userId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  username: {
    type: String,
    sparse: true,
    index: true
  },
  walletAddress: {
    type: String,
    required: true
  },
  tokenBalance: {
    type: Number,
    default: 0
  },
  verifiedAt: {
    type: Date,
    default: Date.now
  },
  lastChecked: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  },
  transactionHash: String,
  sessionId: String
});

// Create indexes for performance
verifiedUserSchema.index({ walletAddress: 1 });
verifiedUserSchema.index({ verifiedAt: -1 });
verifiedUserSchema.index({ isActive: 1 });

const VerifiedUser = model('VerifiedUser', verifiedUserSchema);

module.exports = VerifiedUser;