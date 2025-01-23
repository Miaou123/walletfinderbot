class StateManager {
  constructor() {
    this.messages = new Map();
    this.userStates = new Map();
    this.trackingData = new Map();
  }

  setTrackingInfo(chatId, tokenAddress, info) {
    const key = `${chatId}_${tokenAddress}`;
    this.trackingData.set(key, {
      ...info,
      timestamp: Date.now()
    });
  }

  getTrackingInfo(chatId, tokenAddress) {
    const key = `${chatId}_${tokenAddress}`;
    const data = this.trackingData.get(key);
    
    if (!data) {
      return null;
    }
    
    if (Date.now() - data.timestamp > 5 * 60 * 1000) {
      this.trackingData.delete(key);
      return null;
    }
    
    return data;
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