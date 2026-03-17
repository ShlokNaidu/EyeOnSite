// Audio alert system: alarm sound + text-to-speech voice announcements
// Batches rapid alerts into one announcement (e.g. "5 workers near machinery on camera cam1")

const ALERT_MESSAGES = {
  en: {
    helmet_missing: 'helmet missing',
    vest_missing: 'vest missing',
    restricted_zone: 'restricted zone entry',
    machinery_proximity: 'machinery proximity',
    predicted_machinery_collision: 'predicted collision risk',
    predicted_zone_entry: 'approaching restricted zone',
    no_movement: 'worker has not moved — possible collapse',
  },
  hi: {
    helmet_missing: 'हेलमेट नहीं है',
    vest_missing: 'जैकेट नहीं है',
    restricted_zone: 'प्रतिबंधित क्षेत्र में प्रवेश',
    machinery_proximity: 'मशीनरी के पास',
    predicted_machinery_collision: 'संभावित टकराव का खतरा',
    predicted_zone_entry: 'प्रतिबंधित क्षेत्र के पास जा रहा है',
    no_movement: 'कर्मचारी हिल नहीं रहा है, शायद बेहोश है',
  }
};

const ALERT_SEVERITY = {
  en: {
    machinery_proximity: 'Danger',
    predicted_machinery_collision: 'Warning',
    restricted_zone: 'Alert',
    helmet_missing: 'Warning',
    vest_missing: 'Warning',
    predicted_zone_entry: 'Warning',
    no_movement: 'Emergency',
  },
  hi: {
    machinery_proximity: 'खतरा',
    predicted_machinery_collision: 'चेतावनी',
    restricted_zone: 'चेतावनी',
    helmet_missing: 'चेतावनी',
    vest_missing: 'चेतावनी',
    predicted_zone_entry: 'चेतावनी',
    no_movement: 'आपातकाल',
  }
};

// Camera name cache: camera_id -> display name
const cameraNameCache = {};

export function setCameraNames(cameras) {
  for (const cam of cameras) {
    cameraNameCache[cam.camera_id] = cam.name;
  }
}

export function getCameraName(camera_id) {
  return cameraNameCache[camera_id] || camera_id;
}

export function getWorkerCount(alert) {
  return alert.metadata?.worker_count || 1;
}

export function getVoiceDescription(alert) {
  const lang = localStorage.getItem('voiceLang') || 'en';
  const label = ALERT_MESSAGES[lang]?.[alert.type] || ALERT_MESSAGES['en'][alert.type] || 'safety violation';
  const severity = ALERT_SEVERITY[lang]?.[alert.type] || ALERT_SEVERITY['en'][alert.type] || 'Warning';
  const cameraName = alert.camera_name || getCameraName(alert.camera_id);
  const count = getWorkerCount(alert);
  
  if (lang === 'hi') {
    return `${severity}! कैमरा ${cameraName} पर ${count} कर्मचारी, ${label}`;
  } else {
    return `${severity}! ${count} ${count === 1 ? 'worker' : 'workers'}, ${label}, on camera ${cameraName}`;
  }
}

// Generate alarm beep using Web Audio API (no audio files needed)
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function playAlarmBeep() {
  try {
    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(800, ctx.currentTime);
    oscillator.frequency.setValueAtTime(600, ctx.currentTime + 0.1);
    oscillator.frequency.setValueAtTime(800, ctx.currentTime + 0.2);

    gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.4);
  } catch (e) {
    // Audio context may not be available
  }
}

// Batching: speak immediately on first alert, group follow-ups within a short window
let alertBatch = [];
let batchTimer = null;
let isSpeaking = false;
const BATCH_WINDOW_MS = 3000; // group follow-up alerts for 3 seconds

// Sliding window of recently seen workers so counts reflect total, not just new arrivals
// Key: "type__camera_id__worker_track_id" → timestamp (ms)
const recentWorkers = {};
const RECENT_WINDOW_MS = 15000; // workers seen within 15s count toward total

function pruneRecentWorkers() {
  const cutoff = Date.now() - RECENT_WINDOW_MS;
  for (const key in recentWorkers) {
    if (recentWorkers[key] < cutoff) delete recentWorkers[key];
  }
}

function flushBatch() {
  if (alertBatch.length === 0) { isSpeaking = false; return; }

  const batch = [...alertBatch];
  alertBatch = [];
  batchTimer = null;

  const now = Date.now();

  // Register all workers in this batch into the sliding window
  for (const alert of batch) {
    const workerId = alert.metadata?.worker_track_id || alert.alert_id || Math.random().toString();
    const workerKey = `${alert.type}__${alert.camera_id || 'unknown'}__${workerId}`;
    recentWorkers[workerKey] = now;
  }

  // Prune expired entries
  pruneRecentWorkers();

  // Group all recently-seen workers by type+camera for the announcement
  const groups = {};
  for (const key in recentWorkers) {
    const [type, camera_id] = key.split('__');
    const groupKey = `${type}__${camera_id}`;
    if (!groups[groupKey]) {
      // Grab camera_name from a matching alert in this batch if available
      const matchingAlert = batch.find((a) => a.type === type && (a.camera_id || 'unknown') === camera_id);
      groups[groupKey] = {
        type,
        camera_id,
        camera_name: matchingAlert?.camera_name,
        metadata_worker_count: matchingAlert?.metadata?.worker_count || 0,
        count: 0,
      };
    }
    groups[groupKey].count++;
  }

  const lang = localStorage.getItem('voiceLang') || 'en';

  // Build a single spoken message
  const parts = Object.values(groups).map((g) => {
    const label = ALERT_MESSAGES[lang]?.[g.type] || ALERT_MESSAGES['en'][g.type] || 'safety violation';
    const severity = ALERT_SEVERITY[lang]?.[g.type] || ALERT_SEVERITY['en'][g.type] || 'Warning';
    const cameraName = g.camera_name || cameraNameCache[g.camera_id] || g.camera_id;
    // Use worker_count from metadata if available, else use sliding window count
    const count = g.metadata_worker_count || g.count;
    
    if (lang === 'hi') {
      return `${severity}! कैमरा ${cameraName} पर ${count} कर्मचारी, ${label}`;
    } else {
      return `${severity}! ${count} ${count === 1 ? 'worker' : 'workers'}, ${label}, on camera ${cameraName}`;
    }
  });

  const fullMessage = parts.join('. ');

  // Play one beep + one announcement
  playAlarmBeep();
  if (!('speechSynthesis' in window)) { isSpeaking = false; return; }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(fullMessage);
  utterance.lang = lang === 'hi' ? 'hi-IN' : 'en-US';
  utterance.rate = 0.9;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;
  utterance.onend = () => {
    // After speech ends, flush any alerts that arrived during speech
    if (alertBatch.length > 0) {
      flushBatch();
    } else {
      isSpeaking = false;
    }
  };
  utterance.onerror = () => { isSpeaking = false; };
  window.speechSynthesis.speak(utterance);
}

// Audio-specific cooldown: prevent rapid speech overlap (30s per type+camera+zone)
const audioCooldown = {};
const AUDIO_COOLDOWN_MS = 30 * 1000;

export function triggerAudioAlert(alert) {
  const enabled = localStorage.getItem('voiceEnabled') !== 'false';
  if (!enabled) return;

  // Audio has its own 30s cooldown to prevent speech overlap
  const zoneId = alert.metadata?.zone_id || '';
  const audioKey = `${alert.type}__${alert.camera_id || 'unknown'}__${zoneId}`;
  const now = Date.now();
  if (audioCooldown[audioKey] && now - audioCooldown[audioKey] < AUDIO_COOLDOWN_MS) {
    return; // Visual will show, but skip voice
  }
  audioCooldown[audioKey] = now;

  alertBatch.push(alert);

  if (!isSpeaking) {
    isSpeaking = true;
    if (batchTimer) clearTimeout(batchTimer);
    batchTimer = setTimeout(flushBatch, 1000);
  } else {
    if (batchTimer) clearTimeout(batchTimer);
    batchTimer = setTimeout(flushBatch, BATCH_WINDOW_MS);
  }
}

export function setAudioAlertsEnabled(value) {
  // Now managed by localStorage via Context, but kept for compatibility
  localStorage.setItem('voiceEnabled', value.toString());
  if (!value && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

export function isAudioAlertsEnabled() {
  return localStorage.getItem('voiceEnabled') !== 'false';
}

// Resume audio context after user interaction (required by browsers)
export function resumeAudioContext() {
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}
