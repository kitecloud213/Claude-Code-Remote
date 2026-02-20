/**
 * Telegram Polling Handler
 * Uses getUpdates API instead of webhooks - no public URL needed
 */

const axios = require('axios');
const path = require('path');
const fs = require('fs');
const Logger = require('../../core/logger');
const ControllerInjector = require('../../utils/controller-injector');

class TelegramPollingHandler {
    constructor(config = {}) {
        this.config = config;
        this.logger = new Logger('TelegramPolling');
        this.sessionsDir = path.join(__dirname, '../../data/sessions');
        this.injector = new ControllerInjector();
        this.apiBaseUrl = 'https://api.telegram.org';
        this.botUsername = null;
        this.offset = 0;
        this.running = false;
        this.pollInterval = config.pollInterval || 1000;

        this._ensureDirectories();
    }

    _ensureDirectories() {
        if (!fs.existsSync(this.sessionsDir)) {
            fs.mkdirSync(this.sessionsDir, { recursive: true });
        }
    }

    _getNetworkOptions() {
        const options = {};
        if (this.config.forceIPv4) {
            const https = require('https');
            options.httpsAgent = new https.Agent({ family: 4 });
        }
        return options;
    }

    async start() {
        this.running = true;

        // Delete any existing webhook so getUpdates works
        try {
            await axios.post(
                `${this.apiBaseUrl}/bot${this.config.botToken}/deleteWebhook`,
                {},
                this._getNetworkOptions()
            );
            this.logger.info('Webhook cleared, switching to polling mode');
        } catch (error) {
            this.logger.warn('Failed to clear webhook:', error.message);
        }

        this.logger.info('Polling started');
        this._poll();
    }

    stop() {
        this.running = false;
        this.logger.info('Polling stopped');
    }

    async _poll() {
        while (this.running) {
            try {
                const response = await axios.get(
                    `${this.apiBaseUrl}/bot${this.config.botToken}/getUpdates`,
                    {
                        params: {
                            offset: this.offset,
                            timeout: 30,
                            allowed_updates: ['message', 'callback_query']
                        },
                        timeout: 35000,
                        ...this._getNetworkOptions()
                    }
                );

                const updates = response.data.result || [];
                for (const update of updates) {
                    this.offset = update.update_id + 1;
                    try {
                        if (update.message) {
                            await this._handleMessage(update.message);
                        } else if (update.callback_query) {
                            await this._handleCallbackQuery(update.callback_query);
                        }
                    } catch (error) {
                        this.logger.error('Update handling error:', error.message);
                    }
                }
            } catch (error) {
                if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
                    // Long poll timeout is normal
                    continue;
                }
                this.logger.error('Polling error:', error.message);
                // Wait before retry on error
                await new Promise(r => setTimeout(r, 3000));
            }
        }
    }

    // === Message handling (same logic as webhook.js) ===

    async _handleMessage(message) {
        const chatId = message.chat.id;
        const userId = message.from.id;
        const messageText = message.text?.trim();

        if (!messageText) return;

        if (!this._isAuthorized(userId, chatId)) {
            this.logger.warn(`Unauthorized user/chat: ${userId}/${chatId}`);
            await this._sendMessage(chatId, '⚠️ You are not authorized to use this bot.');
            return;
        }

        if (messageText === '/start') {
            await this._sendWelcomeMessage(chatId);
            return;
        }

        if (messageText === '/help') {
            await this._sendHelpMessage(chatId);
            return;
        }

        const commandMatch = messageText.match(/^\/cmd\s+([A-Z0-9]{8})\s+(.+)$/i);
        if (!commandMatch) {
            const directMatch = messageText.match(/^([A-Z0-9]{8})\s+(.+)$/);
            if (directMatch) {
                await this._processCommand(chatId, directMatch[1], directMatch[2]);
            } else {
                await this._sendMessage(chatId,
                    '❌ Invalid format. Use:\n`/cmd <TOKEN> <command>`\n\nExample:\n`/cmd ABC12345 analyze this code`',
                    { parse_mode: 'Markdown' });
            }
            return;
        }

        await this._processCommand(chatId, commandMatch[1].toUpperCase(), commandMatch[2]);
    }

    async _processCommand(chatId, token, command) {
        const session = await this._findSessionByToken(token);
        if (!session) {
            await this._sendMessage(chatId,
                '❌ Invalid or expired token. Please wait for a new task notification.',
                { parse_mode: 'Markdown' });
            return;
        }

        if (session.expiresAt < Math.floor(Date.now() / 1000)) {
            await this._sendMessage(chatId,
                '❌ Token has expired. Please wait for a new task notification.',
                { parse_mode: 'Markdown' });
            await this._removeSession(session.id);
            return;
        }

        try {
            const tmuxSession = session.tmuxSession || 'default';
            await this.injector.injectCommand(command, tmuxSession);

            await this._sendMessage(chatId,
                `✅ *Command sent successfully*\n\n📝 *Command:* ${command}\n🖥️ *Session:* ${tmuxSession}\n\nClaude is now processing your request...`,
                { parse_mode: 'Markdown' });

            this.logger.info(`Command injected - User: ${chatId}, Token: ${token}, Command: ${command}`);
        } catch (error) {
            this.logger.error('Command injection failed:', error.message);
            await this._sendMessage(chatId,
                `❌ *Command execution failed:* ${error.message}`,
                { parse_mode: 'Markdown' });
        }
    }

    async _handleCallbackQuery(callbackQuery) {
        const chatId = callbackQuery.message.chat.id;
        const data = callbackQuery.data;

        await this._answerCallbackQuery(callbackQuery.id);

        if (data.startsWith('personal:')) {
            const token = data.split(':')[1];
            await this._sendMessage(chatId,
                `📝 *Personal Chat Command Format:*\n\n\`/cmd ${token} <your command>\`\n\n*Example:*\n\`/cmd ${token} Please analyze this code\`\n\n💡 *Copy and paste the format above, then add your command!*`,
                { parse_mode: 'Markdown' });
        } else if (data.startsWith('group:')) {
            const token = data.split(':')[1];
            const botUsername = await this._getBotUsername();
            await this._sendMessage(chatId,
                `👥 *Group Chat Command Format:*\n\n\`@${botUsername} /cmd ${token} <your command>\`\n\n*Example:*\n\`@${botUsername} /cmd ${token} Please analyze this code\`\n\n💡 *Copy and paste the format above, then add your command!*`,
                { parse_mode: 'Markdown' });
        } else if (data.startsWith('session:')) {
            const token = data.split(':')[1];
            await this._sendMessage(chatId,
                `📝 *How to send a command:*\n\nType:\n\`/cmd ${token} <your command>\`\n\nExample:\n\`/cmd ${token} Please analyze this code\``,
                { parse_mode: 'Markdown' });
        }
    }

    // === Helpers ===

    _isAuthorized(userId, chatId) {
        const whitelist = this.config.whitelist || [];

        if (whitelist.includes(String(chatId)) || whitelist.includes(String(userId))) {
            return true;
        }

        if (whitelist.length === 0) {
            const configuredChatId = this.config.chatId || this.config.groupId;
            if (configuredChatId && String(chatId) === String(configuredChatId)) {
                return true;
            }
        }

        return false;
    }

    async _getBotUsername() {
        if (this.botUsername) return this.botUsername;

        try {
            const response = await axios.get(
                `${this.apiBaseUrl}/bot${this.config.botToken}/getMe`,
                this._getNetworkOptions()
            );
            if (response.data.ok && response.data.result.username) {
                this.botUsername = response.data.result.username;
                return this.botUsername;
            }
        } catch (error) {
            this.logger.error('Failed to get bot username:', error.message);
        }

        return this.config.botUsername || 'claude_remote_bot';
    }

    async _sendWelcomeMessage(chatId) {
        await this._sendMessage(chatId,
            `🤖 *Welcome to Claude Code Remote Bot!*\n\n` +
            `I'll notify you when Claude completes tasks or needs input.\n\n` +
            `When you receive a notification with a token, you can send commands back using:\n` +
            `\`/cmd <TOKEN> <your command>\`\n\n` +
            `Type /help for more information.`,
            { parse_mode: 'Markdown' });
    }

    async _sendHelpMessage(chatId) {
        await this._sendMessage(chatId,
            `📚 *Claude Code Remote Bot Help*\n\n` +
            `*Commands:*\n` +
            `• \`/start\` - Welcome message\n` +
            `• \`/help\` - Show this help\n` +
            `• \`/cmd <TOKEN> <command>\` - Send command to Claude\n\n` +
            `*Example:*\n` +
            `\`/cmd ABC12345 analyze the performance of this function\`\n\n` +
            `*Tips:*\n` +
            `• Tokens are case-insensitive\n` +
            `• Tokens expire after 24 hours\n` +
            `• You can also just type \`TOKEN command\` without /cmd`,
            { parse_mode: 'Markdown' });
    }

    async _findSessionByToken(token) {
        try {
            const files = fs.readdirSync(this.sessionsDir);
            for (const file of files) {
                if (!file.endsWith('.json')) continue;
                const sessionPath = path.join(this.sessionsDir, file);
                try {
                    const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
                    if (session.token === token) return session;
                } catch (error) {
                    this.logger.error(`Failed to read session file ${file}:`, error.message);
                }
            }
        } catch (error) {
            this.logger.error('Failed to read sessions directory:', error.message);
        }
        return null;
    }

    async _removeSession(sessionId) {
        const sessionFile = path.join(this.sessionsDir, `${sessionId}.json`);
        if (fs.existsSync(sessionFile)) {
            fs.unlinkSync(sessionFile);
        }
    }

    async _sendMessage(chatId, text, options = {}) {
        try {
            await axios.post(
                `${this.apiBaseUrl}/bot${this.config.botToken}/sendMessage`,
                { chat_id: chatId, text, ...options },
                this._getNetworkOptions()
            );
        } catch (error) {
            this.logger.error('Failed to send message:', error.response?.data || error.message);
        }
    }

    async _answerCallbackQuery(callbackQueryId, text = '') {
        try {
            await axios.post(
                `${this.apiBaseUrl}/bot${this.config.botToken}/answerCallbackQuery`,
                { callback_query_id: callbackQueryId, text },
                this._getNetworkOptions()
            );
        } catch (error) {
            this.logger.error('Failed to answer callback query:', error.response?.data || error.message);
        }
    }
}

module.exports = TelegramPollingHandler;
