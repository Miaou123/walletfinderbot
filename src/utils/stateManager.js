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

  setUserState(userId, state) {
    // Ensure userId is a string to avoid type mismatches
    const key = userId.toString();
    this.userStates.set(key, state);
  }

  getUserState(userId) {
    // Ensure userId is a string when retrieving
    const key = userId.toString();
    return this.userStates.get(key);
  }

  deleteUserState(userId) {
    // Ensure userId is a string when deleting
    const key = userId.toString();
    this.userStates.delete(key);
  }

  setMessage(chatId, messageId, data) {
    this.messages.set(`${chatId}_${messageId}`, data);
  }

  getMessage(chatId, messageId) {
    return this.messages.get(`${chatId}_${messageId}`);
  }
  
  // Get all state keys for debugging
  getAllKeys() {
    return {
      userStates: Array.from(this.userStates.keys()),
      trackingData: Array.from(this.trackingData.keys()),
      messages: Array.from(this.messages.keys())
    };
  }
  
  // Dump state for a specific user/chat for debugging
  dumpState(id) {
    const key = id.toString();
    const state = this.userStates.get(key);
    return {
      exists: !!state,
      context: state?.context,
      command: state?.command,
      timestamp: state?.timestamp,
      hasResults: Array.isArray(state?.results),
      resultCount: Array.isArray(state?.results) ? state.results.length : 0
    };
  }
  
  // Comprehensive cleanup of all states related to a chat
  // By default, we preserve tracking info to allow buttons to continue working
  cleanAllChatStates(chatId, options = { preserveTrackingInfo: true }) {
    if (!chatId) return 0;
    
    const chatIdStr = chatId.toString();
    let count = 0;
    
    // Clean userStates with this chatId
    for (const [key, state] of this.userStates.entries()) {
      if (key === chatIdStr || 
          key === `grp_${chatIdStr}` || 
          state?.chatId === chatIdStr || 
          state?.action === 'awaiting_custom_threshold') {
        this.userStates.delete(key);
        count++;
      }
    }
    
    // Only clean trackingData if preserveTrackingInfo is false
    if (!options.preserveTrackingInfo) {
      // Clean trackingData with this chatId
      for (const key of this.trackingData.keys()) {
        if (key.startsWith(`${chatIdStr}_`)) {
          this.trackingData.delete(key);
          count++;
        }
      }
    }
    
    // Clean messages with this chatId
    for (const key of this.messages.keys()) {
      if (key.startsWith(`${chatIdStr}_`)) {
        this.messages.delete(key);
        count++;
      }
    }
    
    return count;
  }
}

module.exports = new StateManager();