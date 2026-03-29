const EXPRESS_URL = import.meta.env.VITE_EXPRESS_URL || 'http://localhost:5000';
const PYTHON_STREAM_URL = import.meta.env.VITE_PYTHON_STREAM_URL || 'http://localhost:8000';


// --- Auth Token Helpers ---
export function getToken() {
  return localStorage.getItem('eyeonsite_token');
}

export function setToken(token) {
  localStorage.setItem('eyeonsite_token', token);
}

export function clearToken() {
  localStorage.removeItem('eyeonsite_token');
}

// --- Helper ---
async function request(method, path, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };

  // Attach auth token if present
  const token = getToken();
  if (token) {
    opts.headers['Authorization'] = `Bearer ${token}`;
  }

  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${EXPRESS_URL}${path}`, opts);
  const data = await res.json();

  if (!res.ok) {
    // Auto-logout on 401
    if (res.status === 401) {
      clearToken();
    }
    throw new Error(data.error?.message || `Request failed: ${res.status}`);
  }
  return data;
}

// --- Auth APIs ---
export async function loginApi(email, password) {
  const res = await request('POST', '/api/auth/login', { email, password });
  if (res.data?.token) {
    setToken(res.data.token);
  }
  return res;
}

export async function registerApi(siteName, fullName, email, password) {
  const res = await request('POST', '/api/auth/register', { siteName, fullName, email, password });
  if (res.data?.token) {
    setToken(res.data.token);
  }
  return res;
}

export async function getMe() {
  return request('GET', '/api/auth/me');
}

// --- Camera APIs ---
export async function getCameras() {
  return request('GET', '/api/cameras');
}

export async function createCamera(payload) {
  return request('POST', '/api/cameras', payload);
}

export async function updateCamera(camera_id, payload) {
  return request('PUT', `/api/cameras/${camera_id}`, payload);
}

export async function deleteCamera(camera_id) {
  return request('DELETE', `/api/cameras/${camera_id}`);
}

export async function activateCamera(camera_id) {
  return request('POST', `/api/cameras/${camera_id}/activate`);
}

export async function pauseCamera(camera_id) {
  return request('POST', `/api/cameras/${camera_id}/pause`);
}

export async function getCameraStatus(camera_id) {
  return request('GET', `/api/cameras/${camera_id}/status`);
}

export async function getZones(camera_id) {
  return request('GET', `/api/zones/${camera_id}`);
}

export async function createZone(payload) {
  return request('POST', '/api/zones', payload);
}

export async function deleteZone(zone_id) {
  return request('DELETE', `/api/zones/${zone_id}`);
}

// --- Alert APIs ---
export async function getAlerts(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request('GET', `/api/alerts${query ? '?' + query : ''}`);
}

export async function deleteAlert(alert_id) {
  return request('DELETE', `/api/alerts/${alert_id}`);
}

export async function clearAlerts(camera_id) {
  const query = camera_id ? `?camera_id=${camera_id}` : '';
  return request('DELETE', `/api/alerts${query}`);
}

export async function resolveAlert(alert_id, status) {
  return request('PUT', `/api/alerts/${alert_id}/resolve`, { status });
}

// --- Stats APIs ---
export async function getStats(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request('GET', `/api/stats${query ? '?' + query : ''}`);
}

// --- Upload ---
export async function uploadVideo(file) {
  const formData = new FormData();
  formData.append('video_file', file);

  const headers = {};
  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${EXPRESS_URL}/api/upload`, {
    method: 'POST',
    body: formData,
    headers,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Upload failed');
  return data;
}

// --- Stream URL ---
export function getStreamUrl(camera_id) {
  return `${PYTHON_STREAM_URL}/stream/${camera_id}`;
}

// --- Calibration (hits Python AI service directly) ---
export async function calibrateCamera(camera_id, payload) {
  const res = await fetch(`${PYTHON_STREAM_URL}/calibrate_camera`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ camera_id, ...payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Calibration failed');
  return data;
}

// --- Health ---
export async function getHealth() {
  return request('GET', '/api/health');
}

// --- Admin APIs ---
export async function getAdminSites() {
  return request('GET', '/api/admin/sites');
}

export async function getMySites() {
  return request('GET', '/api/sites/my');
}

export async function createAdminSite(payload) {
  return request('POST', '/api/admin/sites', payload);
}

export async function deleteAdminSite(site_id) {
  return request('DELETE', `/api/admin/sites/${site_id}`);
}

export async function getAdminUsers() {
  return request('GET', '/api/admin/users');
}

export async function createAdminUser(payload) {
  return request('POST', '/api/admin/users', payload);
}

export async function updateAdminUser(userId, payload) {
  return request('PUT', `/api/admin/users/${userId}`, payload);
}

export async function deleteAdminUser(userId) {
  return request('DELETE', `/api/admin/users/${userId}`);
}
