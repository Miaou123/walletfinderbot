// utils/stateManager.js
const { RequestCache } = require('./requestCache');

class StateManager {
  constructor() {
    this.messages = new Map();
    this.userStates = new Map();
    this.lastAnalysisResults = {};
    this.pendingTracking = new Map();
    this.scanCache = new RequestCache(3 * 60 * 1000);
    this.teamSupplyCache = new RequestCache(2 * 60 * 1000);
  }

  setTrackingInfo(chatId, tokenAddress, info) {
    const trackingId = `${chatId}_${tokenAddress}`;
    this.lastAnalysisResults[chatId] = info;
    this.pendingTracking.set(trackingId, info);
  }

  getTrackingInfo(chatId, tokenAddress) {
    const trackingId = `${chatId}_${tokenAddress}`;
    return this.pendingTracking.get(trackingId) || this.lastAnalysisResults[chatId];
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