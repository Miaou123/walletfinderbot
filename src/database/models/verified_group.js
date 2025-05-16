// src/database/models/verified_group.js

const { Schema, model } = require('mongoose');
const logger = require('../../utils/logger');

const verifiedGroupSchema = new Schema({
  groupId: { type: String, required: true, index: true, unique: true },
  groupName: { type: String },
  adminUserId: { type: String, required: true },
  adminUsername: { type: String },
  walletAddress: { type: String, required: true },
  tokenBalance: { type: Number, default: 0 },
  verifiedAt: { type: Date, default: Date.now },
  lastChecked: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true },
  transactionHash: String,
  sessionId: String
}, { timestamps: true });

// Create indexes
verifiedGroupSchema.index({ groupId: 1, isActive: 1 });
verifiedGroupSchema.index({ walletAddress: 1 });

// Export using mongoose.model
let VerifiedGroup;
try {
  // Try to get existing model first
  VerifiedGroup = model('VerifiedGroup');
} catch (error) {
  // Model doesn't exist yet, create it
  VerifiedGroup = model('VerifiedGroup', verifiedGroupSchema, 'verifiedGroups');
  logger.debug('VerifiedGroup model initialized');
}

module.exports = VerifiedGroup;