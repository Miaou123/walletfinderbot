const WebSocket = require('ws');


const ws = new WebSocket('wss://mainnet.helius-rpc.com/?api-key=17c9f1f1-12e3-41e9-9d15-6143ad66e393');

// Liste prédéfinie d'adresses à suivre
// Remplacez ces adresses par celles que vous souhaitez suivre
const addressesToTrack  = [
    '3pVNqLzNghGmfWpKh2wSnS2n1aPTuTc83gQDiZjjbtLD'
];

function sendRequest(ws) {
    const request = {
        jsonrpc: "2.0",
        id: 1,
        method: "logsSubscribe",
        params: [
            {
                mentions: addressesToTrack
            },
            {
                commitment: "confirmed"
            }
        ]
    };
    ws.send(JSON.stringify(request));
}

function startPing(ws) {
    setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
            console.log('Ping sent');
        }
    }, 30000); // Ping every 30 seconds
}

ws.on('open', function open() {
    console.log('WebSocket is open');
    sendRequest(ws);
    startPing(ws);
});

ws.on('message', function incoming(data) {
    const messageStr = data.toString('utf8');
    try {
        const messageObj = JSON.parse(messageStr);
        console.log('Received raw message:', JSON.stringify(messageObj, null, 2));
        
        if (messageObj.method === 'logsNotification') {
            const logInfo = messageObj.params.result.value;
            console.log('Transaction detected:');
            console.log('Signature:', logInfo.signature);
            console.log('Logs:', logInfo.logs);
            if (logInfo.signature) {
                console.log('View transaction: https://solscan.io/tx/' + logInfo.signature);
            } else {
                console.log('No signature available for this transaction');
            }
            console.log('---');
        }
    } catch (e) {
        console.error('Failed to parse JSON:', e);
    }
});

ws.on('error', function error(err) {
    console.error('WebSocket error:', err);
});

ws.on('close', function close() {
    console.log('WebSocket is closed');
});

console.log('Starting logs tracker');
console.log('Tracking addresses:', addressesToTrack);