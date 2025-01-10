// utils/stateManager.js
const { RequestCache } = require('./requestCache');
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

  getTrackings(username) {
    // Utilisez directement la méthode du supplyTracker
    console.log(`Fetching trackings for username: ${username}`);
    
    const trackedSupplies = this.supplyTracker.getTrackedSuppliesByUser(username);
    
    console.log('Tracked supplies:', trackedSupplies);
    return trackedSupplies;
  }

  // Modifiez getTrackingInfo pour travailler avec le username
  getTrackingInfo(username, tokenAddress) {
    const trackedSupplies = this.getTrackings(username);
    
    return trackedSupplies.find(tracking => 
      tracking.tokenAddress === tokenAddress || 
      tokenAddress.includes(tracking.tokenAddress)
    );
  }

  setTrackingInfo(chatId, tokenAddress, info) {
    const trackingId = `${chatId}_${tokenAddress}`;
    this.lastAnalysisResults[chatId] = info;
    this.pendingTracking.set(trackingId, info);
  }

  findTrackingByPartialAddress(chatId, partialAddress, trackType) {
    const allTrackings = this.getTrackings(chatId);
    return allTrackings.find(tracking => 
      tracking.tokenAddress.includes(partialAddress) && 
      tracking.trackType === trackType
    );
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