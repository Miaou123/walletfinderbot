const WebSocket = require('ws');
const config = require('../utils/config');
const bot = require('../bot/telegramBot');

const WEBSOCKET_URL = `wss://mainnet.helius-rpc.com/?api-key=${config.HELIUS_API_KEY}`;

let walletConnections = {};
let trackingInfo = {};

function startTracking(tokenAddress, chatId, allTeamWallets, tokenInfo) {
    console.log(`Starting tracking for token: ${tokenAddress}, chatId: ${chatId}`);
    console.log(`Team wallets to track: ${JSON.stringify(allTeamWallets)}`);
    
    if (trackingInfo[tokenAddress]) {
        console.log(`Token ${tokenAddress} already being tracked. Adding new chatId.`);
        trackingInfo[tokenAddress].chatIds.add(chatId);
    } else {
        console.log(`New token to track: ${tokenAddress}`);
        trackingInfo[tokenAddress] = { 
            chatIds: new Set([chatId]), 
            wallets: allTeamWallets,
            tokenInfo: tokenInfo
        };
    }
    
    console.log('Current tracking info:', JSON.stringify(trackingInfo, null, 2));
    
    // Create individual connections for each wallet
    allTeamWallets.forEach(wallet => {
        if (!walletConnections[wallet]) {
            connectWebSocket(wallet);
        }
    });
}

function connectWebSocket(wallet) {
    console.log(`Connecting to WebSocket for wallet: ${wallet}`);
    const ws = new WebSocket(WEBSOCKET_URL);

    ws.on('open', function open() {
        console.log(`WebSocket is open for wallet: ${wallet}`);
        sendSubscribeRequest(ws, wallet);
        startPing(ws, wallet);
    });

    ws.on('message', function incoming(data) {
        const messageStr = data.toString('utf8');
        try {
            const messageObj = JSON.parse(messageStr);
            console.log(`Received for ${wallet}:`, JSON.stringify(messageObj, null, 2));
            if (messageObj.method === 'logsNotification') {
                handleTransaction(messageObj.params.result.value, wallet);
            }
        } catch (e) {
            console.error('Failed to parse JSON:', e);
        }
    });

    ws.on('error', function error(err) {
        console.error(`WebSocket error for ${wallet}:`, err);
    });

    ws.on('close', function close() {
        console.log(`WebSocket is closed for ${wallet}. Reconnecting...`);
        setTimeout(() => connectWebSocket(wallet), 5000);
    });

    walletConnections[wallet] = ws;
}

function sendSubscribeRequest(ws, wallet) {
    const request = {
        jsonrpc: "2.0",
        id: 1,
        method: "logsSubscribe",
        params: [
            {
                mentions: [wallet]
            },
            {
                commitment: "confirmed"
            }
        ]
    };

    ws.send(JSON.stringify(request));
    console.log(`Subscription request sent for wallet: ${wallet}`);
}

function startPing(ws, wallet) {
    setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
            console.log(`Ping sent for wallet: ${wallet}`);
        }
    }, 30000); // Ping every 30 seconds
}

function handleTransaction(txInfo, wallet) {
    console.log(`Handling transaction for wallet ${wallet}:`, txInfo.signature);
    
    if (!txInfo || !txInfo.logs) {
        console.error('Invalid transaction info received:', txInfo);
        return;
    }
    
    Object.entries(trackingInfo).forEach(([tokenAddress, info]) => {
        if (info.wallets.includes(wallet)) {
            console.log(`Transaction involves wallet for token ${tokenAddress}`);
            
            const message = `Transaction detected for ${info.tokenInfo.symbol} (${tokenAddress}):\n` +
                            `Involved wallet: ${wallet}\n` +
                            `Transaction signature: ${txInfo.signature}\n` +
                            `View transaction: https://solscan.io/tx/${txInfo.signature}`;

            info.chatIds.forEach(chatId => {
                console.log(`Sending notification to chatId: ${chatId}`);
                bot.sendMessage(chatId, message)
                    .then(() => console.log(`Notification sent successfully to chatId: ${chatId}`))
                    .catch(error => console.error(`Error sending notification to chatId: ${chatId}`, error));
            });
        }
    });
}

module.exports = { startTracking };