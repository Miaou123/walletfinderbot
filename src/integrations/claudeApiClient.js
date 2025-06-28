// src/integrations/claudeApiClient.js
const logger = require('../utils/logger');

class ClaudeApiClient {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.anthropic.com/v1';
        this.defaultModel = 'claude-3-sonnet-20240229';
    }

    /**
     * Create a message with Claude
     * @param {Object} options - Message options
     * @returns {Promise<Object>} Claude response
     */
    async createMessage(options) {
        try {
            const response = await fetch(`${this.baseUrl}/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: options.model || this.defaultModel,
                    max_tokens: options.max_tokens || 1000,
                    messages: options.messages,
                    temperature: options.temperature || 0.7
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Claude API error: ${response.status} - ${errorText}`);
            }

            const data = await response.json();
            return data;

        } catch (error) {
            logger.error('Error calling Claude API:', error);
            throw error;
        }
    }

    /**
     * Simple text completion for quick responses
     * @param {string} prompt - The prompt to send
     * @param {Object} options - Additional options
     * @returns {Promise<string>} Response text
     */
    async complete(prompt, options = {}) {
        try {
            const response = await this.createMessage({
                model: options.model || this.defaultModel,
                max_tokens: options.max_tokens || 500,
                messages: [{
                    role: 'user',
                    content: prompt
                }],
                temperature: options.temperature || 0.7
            });

            return response.content[0].text;
        } catch (error) {
            logger.error('Error in Claude completion:', error);
            throw error;
        }
    }
}

module.exports = ClaudeApiClient;