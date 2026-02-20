#!/usr/bin/env node

/**
 * Telegram Polling Server
 * Starts the Telegram bot in polling mode (no public URL needed)
 */

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const Logger = require('./src/core/logger');
const TelegramPollingHandler = require('./src/channels/telegram/polling');

// Load environment variables
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
}

const logger = new Logger('Telegram-Polling-Server');

const config = {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    groupId: process.env.TELEGRAM_GROUP_ID,
    whitelist: process.env.TELEGRAM_WHITELIST ? process.env.TELEGRAM_WHITELIST.split(',').map(id => id.trim()) : [],
    forceIPv4: process.env.TELEGRAM_FORCE_IPV4 === 'true',
    pollInterval: parseInt(process.env.TELEGRAM_POLL_INTERVAL) || 1000
};

if (!config.botToken) {
    logger.error('TELEGRAM_BOT_TOKEN must be set in .env file');
    process.exit(1);
}

if (!config.chatId && !config.groupId) {
    logger.error('Either TELEGRAM_CHAT_ID or TELEGRAM_GROUP_ID must be set in .env file');
    process.exit(1);
}

const handler = new TelegramPollingHandler(config);

logger.info('Starting Telegram polling server...');
logger.info(`Chat ID: ${config.chatId || 'Not set'}`);
logger.info(`Group ID: ${config.groupId || 'Not set'}`);
logger.info(`Force IPv4: ${config.forceIPv4}`);

handler.start();

process.on('SIGINT', () => {
    logger.info('Shutting down...');
    handler.stop();
    process.exit(0);
});

process.on('SIGTERM', () => {
    logger.info('Shutting down...');
    handler.stop();
    process.exit(0);
});
