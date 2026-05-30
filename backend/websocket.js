const { WebSocketServer } = require('ws');

let wss = null;

function setupWebSocket(server) {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    console.log('[WS] Client connected. Total:', wss.clients.size);

    ws.on('close', () => {
      console.log('[WS] Client disconnected. Total:', wss.clients.size);
    });

    ws.on('error', (err) => {
      console.error('[WS] Client error:', err.message);
    });
  });

  console.log('[WS] WebSocket server attached');
  return wss;
}

function broadcast(event, data) {
  if (!wss) return;

  const message = JSON.stringify({ event, data });

  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(message);
    }
  });
}

module.exports = { setupWebSocket, broadcast };
