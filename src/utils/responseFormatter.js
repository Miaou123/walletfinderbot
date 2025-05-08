const logger = require('./logger');

/**
 * Utility class for formatting bot responses consistently
 */
class ResponseFormatter {
  /**
   * Format a command response
   * @param {Object} data - The data to include in the response
   * @param {string} commandName - The command name for context
   * @returns {string} Formatted response message
   */
  static formatCommandResponse(data, commandName) {
    try {
      if (!data) {
        return 'No data available.';
      }
      
      if (typeof data === 'string') {
        return data;
      }
      
      // If the data has its own formatter, use it
      if (data.formatted) {
        return data.formatted;
      }
      
      // Default formatting based on data type
      if (Array.isArray(data)) {
        return data.join('\n');
      }
      
      if (typeof data === 'object') {
        return Object.entries(data)
          .map(([key, value]) => `${key}: ${this.formatValue(value)}`)
          .join('\n');
      }
      
      return String(data);
    } catch (error) {
      logger.error(`Error formatting response for ${commandName}:`, error);
      return 'Error formatting response data.';
    }
  }
  
  /**
   * Format a value based on its type
   * @param {any} value - The value to format
   * @returns {string} Formatted value
   * @private
   */
  static formatValue(value) {
    if (value === null || value === undefined) {
      return 'N/A';
    }
    
    if (typeof value === 'number') {
      // Format number with commas for thousands
      return value.toLocaleString();
    }
    
    if (typeof value === 'boolean') {
      return value ? 'Yes' : 'No';
    }
    
    if (value instanceof Date) {
      return value.toLocaleString();
    }
    
    if (Array.isArray(value)) {
      return value.map(v => this.formatValue(v)).join(', ');
    }
    
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    
    return String(value);
  }
  
  /**
   * Format an error message
   * @param {Error} error - The error object
   * @param {boolean} includeDetails - Whether to include error details (for admins)
   * @returns {string} Formatted error message
   */
  static formatErrorMessage(error, includeDetails = false) {
    const baseMessage = 'An error occurred while processing your request.';
    
    if (!includeDetails) {
      return baseMessage;
    }
    
    return `${baseMessage}\n\nError: ${error.message}`;
  }
  
  /**
   * Create a loading message
   * @param {string} commandName - The command being executed
   * @returns {string} Loading message
   */
  static createLoadingMessage(commandName) {
    return `⏳ Processing ${commandName} command...`;
  }
  
  /**
   * Split a long message into chunks respecting message size limits
   * @param {string} message - The message to split
   * @param {number} maxLength - Maximum message length (default: 4096 chars)
   * @returns {Array<string>} Array of message chunks
   */
  static splitMessage(message, maxLength = 4096) {
    if (!message) return [''];
    if (message.length <= maxLength) return [message];
    
    const messages = [];
    let currentMessage = '';
    const lines = message.split('\n');
    
    for (const line of lines) {
      // If adding this line would exceed the max length, push the current message
      if (currentMessage.length + line.length + 1 > maxLength) {
        messages.push(currentMessage.trim());
        currentMessage = line + '\n';
      } else {
        currentMessage += line + '\n';
      }
    }
    
    // Add any remaining content
    if (currentMessage.trim().length > 0) {
      messages.push(currentMessage.trim());
    }
    
    return messages;
  }
  
  /**
   * Format a success message with a result
   * @param {string} action - The action that was performed
   * @param {string} result - The result of the action
   * @returns {string} Formatted success message
   */
  static formatSuccess(action, result = '') {
    return `✅ ${action} successful${result ? `: ${result}` : ''}`;
  }
  
  /**
   * Format a warning message
   * @param {string} message - The warning message
   * @returns {string} Formatted warning message
   */
  static formatWarning(message) {
    return `⚠️ ${message}`;
  }
  
  /**
   * Format a token address for display
   * @param {string} address - The token address
   * @param {number} truncateLength - How many chars to show at start/end
   * @returns {string} Formatted address
   */
  static formatAddress(address, truncateLength = 6) {
    if (!address) return 'N/A';
    if (address.length <= truncateLength * 2) return address;
    
    return `${address.slice(0, truncateLength)}...${address.slice(-truncateLength)}`;
  }
}

module.exports = ResponseFormatter;