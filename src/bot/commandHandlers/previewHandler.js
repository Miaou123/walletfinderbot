const { commandConfigs } = require('../commandsManager/commandConfigs');
const { previewConfigs, formatPreviewMessage } = require('../../utils/previewConfigs');

class PreviewHandler {
    constructor() {
        this.COMMAND_NAME = 'preview';
    }

    async handleCommand(bot, msg, args, messageThreadId) {
        await this.sendPreviewMenu(bot, msg, messageThreadId);
    }

    async sendPreviewMenu(bot, msg, messageThreadId) {
        const welcomeMessage = `<b>👁️ Noesis Bot Command Preview</b>

Discover our powerful trading analysis tools that help over 10,000 traders make data-driven decisions.

<b>💡 How it works:</b>
• Click any command below to see a live preview
• Test the features before subscribing
• Use /subscribe to unlock all commands

<b>Select a command to preview:</b>`;

        // Create buttons for each command category
        const keyboard = this.createCommandButtons();

        await bot.sendMessage(msg.chat.id, welcomeMessage, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: keyboard
            },
            message_thread_id: messageThreadId
        });
    }

    createCommandButtons() {
        // Group commands by category
        const categories = {
            'free': { emoji: '🆓', commands: [] },
            'advanced': { emoji: '💫', commands: [] }
        };

        // Sort commands into categories
        Object.entries(commandConfigs).forEach(([cmdName, config]) => {
            if (['scan', 'bundle', 'walletchecker', 'dexpaid'].includes(cmdName)) {
                categories.free.commands.push({ name: cmdName, config });
            } else if (config.requiresAuth) {
                categories.advanced.commands.push({ name: cmdName, config });
            } else if (!['start', 'help', 'ping', 'subscribe', 'referral', 'subscribe_group', 'preview'].includes(cmdName)) {
                categories.free.commands.push({ name: cmdName, config });
            }
        });

        // Create keyboard layout
        const keyboard = [];

        // Add category buttons
        const commandEmojis = {
            'scan': '🔍', 'bundle': '📦', 'walletchecker': '📊',
            'dexpaid': '💰', 'topholders': '👥', 'dev': '👨‍💻',
            'team': '👥', 'entrymap': '📈', 'freshratio': '📊',
            'earlybuyers': '⚡', 'besttraders': '🏆', 'cross': '🔄',
            'crossbt': '🔄', 'search': '🔎', 'tracker': '👁️',
            'subscribe': '💫', 'referral': '🔗'
        };

        let currentRow = [];
        Object.entries(categories).forEach(([category, { commands }]) => {
            commands.forEach(({ name, config }) => {
                const displayName = config.aliases && config.aliases.length > 0 
                    ? `${name} (/${config.aliases[0]})` 
                    : name;
                
                currentRow.push({
                    text: `${commandEmojis[name] || '🔹'} ${displayName}`,
                    callback_data: `preview:${name}`
                });

                if (currentRow.length === 2) {
                    keyboard.push(currentRow);
                    currentRow = [];
                }
            });
            
            if (currentRow.length > 0) {
                keyboard.push(currentRow);
                currentRow = [];
            }
        });

        return keyboard;
    }

    async handleCallback(bot, query) {
        try {
            if (query.data === 'preview:back') {
                const welcomeMessage = `<b>👁️ Noesis Bot Command Preview</b>

Discover our powerful trading analysis tools that help over 10,000 traders make data-driven decisions.

<b>💡 How it works:</b>
• Click any command below to see a live preview
• Test the features before subscribing
• Use /subscribe to unlock all commands

<b>Select a command to preview:</b>`;
                const keyboard = this.createCommandButtons();
                
                await bot.editMessageText(welcomeMessage, {
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: keyboard
                    }
                });
                return;
            }

            const command = query.data.split(':')[1];
            if (!command) {
                throw new Error('Invalid command in callback data');
            }

            const config = commandConfigs[command];
            if (!config) {
                await bot.answerCallbackQuery(query.id, {
                    text: 'Preview not available for this command.',
                    show_alert: true
                });
                return;
            }

            const previewContent = this.getCommandPreview(command, config);

            await bot.editMessageText(previewContent, {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '← Back to Commands', callback_data: 'preview:back' }]
                    ]
                }
            });

            await bot.answerCallbackQuery(query.id);
        } catch (error) {
            console.error('Preview callback error:', error);
            await bot.answerCallbackQuery(query.id, {
                text: 'An error occurred while showing the preview',
                show_alert: true
            });
        }
    }

    getCommandPreview(command, config) {
        const previewConfig = previewConfigs[command];
        if (!previewConfig) {
            return `<b>${config.description}</b>\n\n` +
                   `Preview for /${command} command is coming soon!`;
        }
        
        return formatPreviewMessage(previewConfig);
    }
}

module.exports = PreviewHandler;