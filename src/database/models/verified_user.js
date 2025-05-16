// src/database/models/verified_user.js
const { Schema, model } = require('mongoose');
const logger = require('../../utils/logger');

const verifiedUserSchema = new Schema({
  userId: { type: String, required: true, index: true },
  username: { type: String },
  walletAddress: { type: String, required: true },
  tokenBalance: { type: Number, default: 0 },
  verifiedAt: { type: Date, default: Date.now },
  lastChecked: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true },
  transactionHash: String,
  sessionId: String
}, { timestamps: true });

// Create a compound index for quick lookups
verifiedUserSchema.index({ userId: 1, isActive: 1 });

// Export using mongoose.model
let VerifiedUser;
try {
  // Try to get existing model first
  VerifiedUser = model('VerifiedUser');
} catch (error) {
  // Model doesn't exist yet, create it
  VerifiedUser = model('VerifiedUser', verifiedUserSchema, 'verifiedUsers');
  logger.debug('VerifiedUser model initialized');
}

module.exports = VerifiedUser;