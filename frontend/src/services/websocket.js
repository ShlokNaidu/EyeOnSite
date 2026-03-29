import { triggerAudioAlert } from './audioAlerts';

const _expressBase = import.meta.env.VITE_EXPRESS_URL || 'http://localhost:5000';
const WS_URL = _expressBase.replace(/^http/, 'ws');

let ws = null;
let listeners = [];
let reconnectTimer = null;

// Lightweight frontend cooldown — AI service + server do the smart logic
// This just prevents edge cases from WebSocket race conditions
const alertCooldown = {}; // key → timestamp (ms)
const PREDICTIVE_COOLDOWN_MS = 15 * 1000;
const REACTIVE_MIN_GAP_MS = 5 * 1000;
const PREDICTIVE_TYPES = ['predicted_machinery_collision', 'predicted_zone_entry'];

function shouldProcessAlert(alert) {
  const zoneId = alert.metadata?.zone_id || '';
  const key = `${alert.type}__${alert.camera_id || 'unknown'}__${zoneId}`;
  const now = Date.now();
  const cooldown = PREDICTIVE_TYPES.includes(alert.type) ? PREDICTIVE_COOLDOWN_MS : REACTIVE_MIN_GAP_MS;
  if (alertCooldown[key] && now - alertCooldown[key] < cooldown) {
    return false;
  }
  alertCooldown[key] = now;
  return true;
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log('[WS] Connected');
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      // Apply unified cooldown for new alerts (voice + visual)
      if (msg.event === 'new_alert' && msg.data) {
        if (!shouldProcessAlert(msg.data)) return;
        triggerAudioAlert(msg.data);
      }
      listeners.forEach((fn) => fn(msg));
    } catch (e) {
      console.error('[WS] Parse error:', e);
    }
  };

  ws.onclose = () => {
    console.log('[WS] Disconnected, reconnecting in 3s...');
    reconnectTimer = setTimeout(connect, 3000);
  };

  ws.onerror = (err) => {
    console.error('[WS] Error:', err);
    ws.close();
  };
}

export function addAlertListener(fn) {
  listeners.push(fn);
  // Auto-connect on first listener
  if (listeners.length === 1) connect();

  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

export function removeAlertListener(fn) {
  listeners = listeners.filter((l) => l !== fn);
}

// Connect immediately when imported
connect();
