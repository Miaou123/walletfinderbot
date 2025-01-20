// utils/stateManager.js
const { RequestCache } = require('./requestCache');
const logger = require('./logger');
const fs = require('fs');
const path = require('path');

class StateManager {
  constructor() {
    this.messages = new Map();
    this.userStates = new Map();
    this.lastAnalysisResults = {};
    this.pendingTracking = new Map();
    this.scanCache = new RequestCache(3 * 60 * 1000);
    this.teamSupplyCache = new RequestCache(2 * 60 * 1000);

    this.trackingDataPath = path.join(__dirname, '..', 'data', 'trackers.json');
  }

  getTrackings(chatId) {
    // Utilisez directement la méthode du supplyTracker
    console.log(`Fetching trackings for chatId: ${chatId}`);
    
    const trackedSupplies = this.supplyTracker.getTrackedSuppliesByUser(chatId);
    
    console.log('Tracked supplies:', trackedSupplies);
    return trackedSupplies;
  }

  getTrackingInfo(chatId, tokenAddress) {
    const trackingId = `${chatId}_${tokenAddress}`;
    logger.debug(`Getting tracking info for trackingId: ${trackingId}`);
    const pendingInfo = this.pendingTracking.get(trackingId);
    const lastAnalysisInfo = this.lastAnalysisResults[chatId];
    logger.debug('Pending info:', pendingInfo);
    logger.debug('Last analysis info:', lastAnalysisInfo);
    return pendingInfo || lastAnalysisInfo;
}

setTrackingInfo(chatId, tokenAddress, info) {
    const trackingId = `${chatId}_${tokenAddress}`;
    logger.debug(`Setting tracking info for trackingId: ${trackingId}`);
    logger.debug('Info to set:', JSON.stringify(info, null, 2));
    this.lastAnalysisResults[chatId] = info;
    this.pendingTracking.set(trackingId, info);
}

  setUserState(chatId, state) {
    this.userStates.set(chatId, state);
  }

  getUserState(chatId) {
    return this.userStates.get(chatId);
  }

  deleteUserState(chatId) {
    this.userStates.delete(chatId);
  }

  setMessage(chatId, messageId, data) {
    this.messages.set(`${chatId}_${messageId}`, data);
  }

  getMessage(chatId, messageId) {
    return this.messages.get(`${chatId}_${messageId}`);
  }
}

module.exports = new StateManager();