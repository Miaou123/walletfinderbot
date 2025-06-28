// src/bot/commandHandlers/aiAssistantHandler.js
const BaseHandler = require('./baseHandler');
const logger = require('../../utils/logger');
const { commandConfigs } = require('../commandsManager/commandConfigs');
const { previewConfigs } = require('../../utils/previewConfigs');

class AIAssistantHandler extends BaseHandler {
    constructor(claudeApiClient) {
        super();
        this.COMMAND_NAME = 'ask';
        this.claudeClient = claudeApiClient;
    }

    /**
     * Main command handler
     */
    async handleCommand(bot, msg, args, messageThreadId) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const userQuestion = args.join(' ');

        if (!userQuestion.trim()) {
            await this.sendHelpMessage(bot, chatId, messageThreadId);
            return;
        }

        logger.info(`AI Assistant query from ${msg.from.username}: "${userQuestion}"`);

        try {
            // Get AI response directly without loading message
            const aiResponse = await this.getIntelligentResponse(userQuestion);

            // Send the AI response
            await this.sendMessage(bot, chatId, aiResponse, { message_thread_id: messageThreadId });

        } catch (error) {
            logger.error('Error in AI Assistant:', error);
            
            await this.sendMessage(bot, chatId, 
                '❌ Sorry, I encountered an error while processing your question. Please try again or use `/help` to see available commands.',
                { message_thread_id: messageThreadId }
            );
        }
    }

    /**
     * Get intelligent response using Claude with full context
     */
    async getIntelligentResponse(userQuestion) {
        if (!this.claudeClient) {
            return this.getFallbackResponse(userQuestion);
        }

        try {
            const systemPrompt = this.buildSystemPrompt();
            const userPrompt = this.buildUserPrompt(userQuestion);

            const response = await this.claudeClient.createMessage({
                model: 'claude-3-sonnet-20240229',
                max_tokens: 1500,
                messages: [
                    { role: 'user', content: `${systemPrompt}\n\n${userPrompt}` }
                ],
                temperature: 0.3 // Lower temperature for more consistent, focused responses
            });

            return this.formatAIResponse(response.content[0].text);

        } catch (error) {
            logger.error('Error calling Claude API:', error);
            return this.getFallbackResponse(userQuestion);
        }
    }

    /**
     * Build comprehensive system prompt with all command knowledge
     */
    buildSystemPrompt() {
        const commandsDocumentation = this.generateCommandsDocumentation();
        
        return `You are an AI assistant for the Noesis Telegram bot, which provides advanced Solana blockchain analysis tools. Your job is to help users find the right commands and parameters for their specific needs.

IMPORTANT GUIDELINES:
1. Give direct, concise answers without explaining your thought process
2. Always recommend specific commands with exact usage examples
3. Suggest optimal parameters based on the user's intent
4. Keep responses short and actionable
5. Use the exact command syntax and parameter format from the documentation
6. Include subscription info only when relevant
7. Use emojis and formatting for clarity

${commandsDocumentation}

RESPONSE FORMAT:
- Directly recommend the best command(s) with specific examples
- Brief explanation of parameters if needed
- Keep it concise and practical - no "thinking out loud"`;
    }

    /**
     * Generate comprehensive documentation for all commands
     */
    generateCommandsDocumentation() {
        let documentation = "NOESIS COMMANDS DOCUMENTATION:\n\n";

        documentation += this.getSubscriptionInfo();
        documentation += this.getCommandCategories();
        documentation += this.getDetailedCommandDocs();
        documentation += this.getExampleOutputs();

        return documentation;
    }

    /**
     * Get subscription and pricing information
     */
    getSubscriptionInfo() {
        return `SUBSCRIPTION INFO:
• Personal subscription: 0.5 SOL/month (use /subscribe)
• Group subscription: 2 SOL/month (use /subscribe_group)
• Some commands are free for everyone
• Use /preview to test premium features before subscribing
• 10% discount with referral links (/referral)

FREE COMMANDS: scan, bundle, walletchecker, dexpaid, topholders
PREMIUM COMMANDS: All others require subscription

`;
    }

    /**
     * Get command categories and overview
     */
    getCommandCategories() {
        return `COMMAND CATEGORIES:

🔍 TOKEN ANALYSIS:
• /scan - Top holders analysis (FREE)
• /topholders - Detailed holder breakdown
• /dexpaid - Check DexScreener promotions (FREE)

⚡ EARLY BUYER ANALYSIS:
• /earlybuyers - Find early buyers and whales
• /fresh - Analyze fresh wallets and funding sources
• /team - Detect team/insider supply

👛 WALLET ANALYSIS:
• /walletchecker - Detailed wallet analysis (FREE)
• /besttraders - Find top performing traders
• /walletsearch - Search 100k+ wallet database
• /dev - Analyze developer history

🔄 CROSS ANALYSIS:
• /cross - Find common holders between tokens
• /crossbt - Cross-analyze top traders
• /bundle - Detect coordinated buying (FREE)

🔎 SEARCH & TRACKING:
• /search - Find wallets by partial address
• /tracker - Manage supply tracking

`;
    }

    /**
     * Get detailed documentation for each command
     */
    getDetailedCommandDocs() {
        let docs = "DETAILED COMMAND DOCUMENTATION:\n\n";

        Object.entries(commandConfigs).forEach(([commandName, config]) => {
            docs += this.generateDetailedCommandDoc(commandName, config);
        });

        return docs;
    }

    /**
     * Generate detailed documentation for a single command
     */
    generateDetailedCommandDoc(commandName, config) {
        let doc = `/${commandName}`;
        
        // Add aliases
        if (config.aliases && config.aliases.length > 0) {
            doc += ` (${config.aliases.map(a => `/${a}`).join(', ')})`;
        }
        
        doc += `\n`;
        doc += `Description: ${config.description}\n`;
        doc += `Usage: ${config.usage}\n`;
        
        // Add access info
        if (config.requiresAuth) {
            doc += `Access: PREMIUM (requires subscription)\n`;
        } else {
            doc += `Access: FREE\n`;
        }
        
        // Add detailed help message if available
        if (config.helpMessage && config.helpMessage.trim()) {
            doc += `Details: ${config.helpMessage}\n`;
        }
        
        // Add parameter explanations for key commands
        const parameterExplanations = this.getParameterExplanations(commandName);
        if (parameterExplanations) {
            doc += parameterExplanations;
        }
        
        doc += '\n';
        return doc;
    }

    /**
     * Get example outputs from preview configs
     */
    getExampleOutputs() {
        if (!previewConfigs) return '';
        
        let examples = "EXAMPLE COMMAND OUTPUTS:\n\n";
        
        Object.entries(previewConfigs).forEach(([commandName, config]) => {
            if (config.preview && config.preview.response) {
                examples += `${commandName.toUpperCase()} EXAMPLE:\n`;
                examples += `Command: ${config.preview.command}\n`;
                examples += `Output: ${config.preview.response}\n\n`;
            }
        });
        
        return examples;
    }

    /**
     * Generate detailed documentation for a single command
     */
    generateSingleCommandDoc(commandName, config) {
        // This method is now replaced by generateDetailedCommandDoc
        return this.generateDetailedCommandDoc(commandName, config);
    }

    /**
     * Get specific parameter explanations for key commands
     */
    getParameterExplanations(commandName) {
        const explanations = {
            'earlybuyers': `
  Parameters:
    - token_address: The Solana token address to analyze
    - timeframe: How far back to look (e.g., 1h, 2h, 0.5h for 30min)
    - percentage: Minimum % of supply bought to be considered (e.g., 1%, 2% for whales)
    - Use higher percentages (2%+) to find whale buyers specifically`,
            
            'scan': `
  Parameters:
    - token_address: The Solana token address to analyze
    - Shows comprehensive token analysis including top holders and supply distribution`,
            
            'walletchecker': `
  Parameters:
    - wallet_address: The Solana wallet address to analyze
    - Provides detailed wallet performance and trading history`,
            
            'bundle': `
  Parameters:
    - token_address: The Solana token address to check for bundle activity
    - Detects coordinated buying patterns and suspicious activity`,
            
            'cross': `
  Parameters:
    - token1_address token2_address: Two or more token addresses
    - value_threshold: Minimum portfolio value (optional, e.g., $1000)
    - Finds wallets that hold multiple specified tokens`,
            
            'fresh': `
  Parameters:
    - token_address: The Solana token address to analyze
    - percentage: Minimum % threshold for fresh wallet detection
    - Finds new wallets and their funding sources`,
            
            'besttraders': `
  Parameters:
    - token_address: The Solana token address to analyze
    - Shows top performing traders for this token`,
            
            'walletsearch': `
  Parameters: Interactive command - follow the prompts
    - Search through 100k+ indexed wallets by criteria
    - Filter by winrate, portfolio value, etc.`,
            
            'topholders': `
  Parameters:
    - token_address: The Solana token address to analyze
    - Shows largest holders and their wallet information`
        };
        
        return explanations[commandName] || '';
    }

    /**
     * Build user prompt with their specific question
     */
    buildUserPrompt(userQuestion) {
        return `USER QUESTION: "${userQuestion}"

Provide a direct, concise response with the most helpful Noesis command(s). Keep it short and actionable.`;
    }

    /**
     * Format AI response with consistent styling
     */
    formatAIResponse(aiText) {
        return aiText; // Return the AI text directly without any prefix
    }

    /**
     * Fallback response when Claude API is not available
     */
    getFallbackResponse(userQuestion) {
        const lowerQuestion = userQuestion.toLowerCase();
        
        // Simple keyword-based fallbacks
        if (lowerQuestion.includes('early') && (lowerQuestion.includes('buyer') || lowerQuestion.includes('whale'))) {
            return `Use <b>/earlybuyers</b> to find early buyers and whales:

<code>/earlybuyers [token_address] [timeframe] [percentage]</code>

<b>Example:</b>
<code>/earlybuyers So11111111111111111111111111111111111112 1h 2%</code>

This finds wallets that bought at least 2% of supply in the first hour.

<i>💡 Premium command - requires subscription</i>`;
        }
        
        if (lowerQuestion.includes('wallet') && lowerQuestion.includes('check')) {
            return `Use <b>/walletchecker</b> to analyze any wallet:

<code>/walletchecker [wallet_address]</code>

<b>Example:</b>
<code>/walletchecker 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM</code>

Shows detailed wallet analysis and trading performance.

<i>💡 Free command</i>`;
        }

        if (lowerQuestion.includes('holder') && (lowerQuestion.includes('good') || lowerQuestion.includes('quality'))) {
            return `Use <b>/scan</b> to analyze token holders:

<code>/scan [token_address]</code>

<b>Example:</b>
<code>/scan So11111111111111111111111111111111111112</code>

Shows top holders and supply distribution to assess holder quality.

<i>💡 Free command</i>`;
        }
        
        // Generic fallback
        return `<b>🔍 Popular Commands:</b>
• <code>/scan [token]</code> - Token analysis
• <code>/earlybuyers [token] [time] [%]</code> - Find early buyers
• <code>/walletchecker [wallet]</code> - Analyze wallet
• <code>/bundle [token]</code> - Detect coordinated buying
• <code>/cross [token1] [token2]</code> - Find common holders

Use <code>/help [command]</code> for details or ask me a specific question!`;
    }

    /**
     * Send help message for the AI assistant
     */
    async sendHelpMessage(bot, chatId, messageThreadId) {
        const helpMessage = `<b>🤖 AI Assistant</b>

Ask me anything about Solana analysis and I'll recommend the best commands!

<b>📝 How to use:</b>
<code>/ask [your question]</code>

<b>💡 Example questions:</b>
• "How can I find early whales that bought X coin?"
• "What's the best way to analyze wallet performance?"
• "How do I detect coordinated buying activity?"
• "Show me commands for finding common holders"

<b>🧠 I understand context and suggest optimal parameters!</b>

<i>Aliases: /ai or /assistant</i>`;

        await this.sendMessage(bot, chatId, helpMessage, { message_thread_id: messageThreadId });
    }
}

module.exports = AIAssistantHandler;