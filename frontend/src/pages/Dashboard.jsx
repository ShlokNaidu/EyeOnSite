import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { getCameras, getAlerts, getStats, getStreamUrl, deleteAlert, getAdminUsers, getMySites, pauseCamera, activateCamera } from '../services/api';
import { setCameraNames, getCameraName, getWorkerCount } from '../services/audioAlerts';
import { addAlertListener } from '../services/websocket';
import { resumeAudioContext } from '../services/audioAlerts';
import {
  Activity, AlertTriangle, Shield, Camera, Trash2, Users,
  ChevronDown, ChevronRight, MapPin, Pause, Play, Radio, ZoomIn, ZoomOut, X, Maximize2,
} from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import ConfirmDialog from '../components/ConfirmDialog';

const EXPRESS_URL = import.meta.env.VITE_EXPRESS_URL || 'http://localhost:5000';

export default function Dashboard() {
  const [cameras, setCameras] = useState([]);
  const [sites, setSites] = useState([]);
  const [expandedSites, setExpandedSites] = useState({});
  const [recentAlerts, setRecentAlerts] = useState([]);
  const [stats, setStats] = useState(null);
  const [adminCount, setAdminCount] = useState(0);
  const [totalCameras, setTotalCameras] = useState(0);
  const [totalSites, setTotalSites] = useState(0);
  // per-camera control state: { [camera_id]: { paused: bool, flaggedSnap: url|null } }
  const [camControls, setCamControls] = useState({});
  // zoom modal
  const [zoomCam, setZoomCam] = useState(null); // camera object or null
  const [zoomLevel, setZoomLevel] = useState(1);
  // confirm dialog
  const [confirmDialog, setConfirmDialog] = useState({ open: false, alertId: null });

  const { t } = useLanguage();
  const { isAdmin, isSuperAdmin } = useAuth();

  useEffect(() => {
    loadData();
    if (!isSuperAdmin) {
      const remove = addAlertListener((msg) => {
        if (msg.event === 'new_alert') {
          setRecentAlerts((prev) => [msg.data, ...prev].slice(0, 10));
        }
      });
      return remove;
    }
  }, [isSuperAdmin]);

  async function loadData() {
    try {
      if (isSuperAdmin) {
        const [usersRes, camsRes, sitesRes] = await Promise.all([
          getAdminUsers(),
          getCameras().catch(() => ({ data: [] })),
          getMySites().catch(() => ({ data: [] })),
        ]);
        const admins = (usersRes.data || []).filter(u => u.role === 'admin');
        setAdminCount(admins.length);
        setTotalCameras((camsRes.data || []).length);
        setTotalSites((sitesRes.data || []).length);
      } else {
        const [camRes, alertRes, statsRes, sitesRes] = await Promise.all([
          getCameras(),
          getAlerts({ limit: 10 }),
          getStats({}),
          getMySites().catch(() => ({ data: [] })),
        ]);
        const cams = camRes.data || [];
        setCameras(cams);
        setCameraNames(cams);
        setRecentAlerts(alertRes.data || []);
        setStats(statsRes.data || null);
        const fetchedSites = sitesRes.data || [];
        setSites(fetchedSites);
        // Auto-expand all sites
        const expanded = {};
        fetchedSites.forEach(s => { expanded[s.site_id] = true; });
        if (fetchedSites.length === 0) {
          expanded['__unassigned__'] = true;
        }
        setExpandedSites(expanded);
      }
    } catch (err) {
      console.error('Dashboard load error:', err);
    }
  }

  function handleDeleteAlert(alert_id) {
    setConfirmDialog({ open: true, alertId: alert_id });
  }

  async function doDeleteAlert() {
    const alert_id = confirmDialog.alertId;
    setConfirmDialog({ open: false, alertId: null });
    try {
      await deleteAlert(alert_id);
      setRecentAlerts(prev => prev.filter(a => a.alert_id !== alert_id));
    } catch (err) {
      console.error('Delete alert error:', err);
    }
  }

  // ── Camera playback controls ──────────────────────────────────────────────
  async function handlePauseCam(cam) {
    try {
      await pauseCamera(cam.camera_id);
      // Fetch the most recent alert snapshot for this camera to show as flagged frame
      let flaggedSnap = null;
      try {
        const res = await getAlerts({ camera_id: cam.camera_id, limit: 1 });
        const latest = (res.data || [])[0];
        if (latest?.snapshot_url) {
          flaggedSnap = `${EXPRESS_URL}${latest.snapshot_url}`;
        }
      } catch {}
      setCamControls(prev => ({
        ...prev,
        [cam.camera_id]: { paused: true, flaggedSnap },
      }));
    } catch (err) {
      console.error('Pause error:', err);
    }
  }

  async function handleResumeCam(cam) {
    try {
      await activateCamera(cam.camera_id);
      setCamControls(prev => ({
        ...prev,
        [cam.camera_id]: { paused: false, flaggedSnap: null },
      }));
    } catch (err) {
      console.error('Resume error:', err);
    }
  }

  function handleZoomOpen(cam) {
    setZoomCam(cam);
    setZoomLevel(1);
  }
  function handleZoomClose() {
    setZoomCam(null);
    setZoomLevel(1);
  }

  // ── Super admin view ─────────────────────────────────────────────────────
  if (isSuperAdmin) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-slate-800">{t('dashboard')} — Super Admin</h1>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <KPICard icon={Users} label="Total Active Admins" value={adminCount} color="purple" />
          <KPICard icon={Camera} label="Total Cameras" value={totalCameras} color="blue" />
          <KPICard icon={MapPin} label="Total Sites" value={totalSites} color="green" />
        </div>
        <div className="bg-white rounded-lg p-8 border border-slate-200 text-center text-slate-500 shadow-sm">
          Welcome to the Super Admin Dashboard. Use the <b>Users</b> tab to manage administrators and site data.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6" onClick={resumeAudioContext}>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">{t('dashboard')}</h1>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <KPICard icon={Camera} label="Active Cameras" value={cameras.filter(c => c.is_active).length} color="blue" />
        <KPICard icon={AlertTriangle} label="Total Alerts" value={stats?.total_alerts || 0} color="red" />
        <KPICard icon={Shield} label="Safety Score" value={stats?.safety_score ?? '—'} color="green" />
        <KPICard
          icon={Activity}
          label="Alerts Today"
          value={recentAlerts.filter(a => new Date(a.timestamp).toDateString() === new Date().toDateString()).length}
          color="yellow"
        />
      </div>

      {/* Live Streams */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-3 text-slate-700">Live Streams</h2>
        {cameras.length === 0 ? (
          <p className="text-slate-400">No cameras configured. Add one in the Cameras page.</p>
        ) : (
          <SiteGroupedCameras
            cameras={cameras}
            sites={sites}
            expandedSites={expandedSites}
            setExpandedSites={setExpandedSites}
            isAdmin={isAdmin}
            camControls={camControls}
            onPause={handlePauseCam}
            onResume={handleResumeCam}
            onZoom={handleZoomOpen}
          />
        )}
      </div>

      {/* Recent Alerts — site officers only */}
      {!isAdmin && (
        <div>
          <h2 className="text-lg font-semibold mb-3 text-slate-700">Recent Alerts</h2>
          {recentAlerts.length === 0 ? (
            <p className="text-slate-400">{t('no_alerts')}</p>
          ) : (
            <div className="bg-white rounded-lg border border-sky-200 divide-y divide-sky-100 shadow-sm">
              {recentAlerts.map((alert) => (
                <div key={alert.alert_id} className="p-3 flex items-center justify-between hover:bg-slate-50">
                  <div>
                    <span className="text-sm font-medium text-red-600">{t(alert.type) || alert.type}</span>
                    <span className="text-xs text-yellow-600 ml-2">
                      ({getWorkerCount(alert)} {getWorkerCount(alert) === 1 ? 'worker' : 'workers'})
                    </span>
                    <span className="text-xs text-slate-400 ml-3">
                      {t('camera')}: {alert.camera_name || getCameraName(alert.camera_id)}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-slate-400">{new Date(alert.timestamp).toLocaleTimeString()}</span>
                    <button onClick={() => handleDeleteAlert(alert.alert_id)} className="text-red-400 hover:text-red-600" title="Delete Alert">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Zoom Modal */}
      {zoomCam && (
        <ZoomModal
          cam={zoomCam}
          camControls={camControls}
          zoomLevel={zoomLevel}
          setZoomLevel={setZoomLevel}
          onPause={handlePauseCam}
          onResume={handleResumeCam}
          onClose={handleZoomClose}
          isAdmin={isAdmin}
        />
      )}

      {/* Delete Alert Confirm Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.open}
        title="Delete this alert?"
        message="This alert will be permanently removed."
        onConfirm={doDeleteAlert}
        onCancel={() => setConfirmDialog({ open: false, alertId: null })}
      />
    </div>
  );
}

// ── Zoom Modal ────────────────────────────────────────────────────────────────
function ZoomModal({ cam, camControls, zoomLevel, setZoomLevel, onPause, onResume, onClose, isAdmin }) {
  const ctrl = camControls[cam.camera_id] || { paused: false, flaggedSnap: null };
  const streamSrc = `${getStreamUrl(cam.camera_id)}?ctx=zoom`;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="relative bg-black rounded-xl overflow-hidden shadow-2xl"
        style={{ width: 'min(90vw, 1100px)', maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 bg-slate-900/90">
          <span className="text-white text-sm font-semibold">{cam.name}</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Zoom: {Math.round(zoomLevel * 100)}%</span>
            <button onClick={() => setZoomLevel(z => Math.min(z + 0.25, 4))}
              className="p-1 text-slate-300 hover:text-white" title="Zoom in">
              <ZoomIn className="w-4 h-4" />
            </button>
            <button onClick={() => setZoomLevel(z => Math.max(z - 0.25, 1))}
              className="p-1 text-slate-300 hover:text-white" title="Zoom out"
              disabled={zoomLevel <= 1}>
              <ZoomOut className="w-4 h-4 disabled:opacity-40" />
            </button>
            <button onClick={onClose} className="p-1 text-slate-300 hover:text-white ml-2">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Stream */}
        <div className="overflow-auto" style={{ maxHeight: 'calc(90vh - 96px)' }}>
          <div style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top left',
            width: `${100 / zoomLevel}%`, transition: 'transform 0.2s ease' }}>
            {ctrl.paused && ctrl.flaggedSnap ? (
              <div className="relative">
                <img src={ctrl.flaggedSnap} alt="Last flagged frame" className="w-full" />
                <div className="absolute top-2 left-2 bg-red-600/90 text-white text-xs px-2 py-1 rounded font-medium">
                  ⚠ Last Flagged Frame
                </div>
              </div>
            ) : (
              <img
                src={`${streamSrc}&retry=${Date.now()}`}
                alt={cam.name}
                className="w-full"
                onError={(e) => {
                  setTimeout(() => { e.target.src = `${getStreamUrl(cam.camera_id)}?ctx=zoom&retry=${Date.now()}`; }, 2000);
                }}
              />
            )}
          </div>
        </div>

        {/* Controls footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-2 bg-slate-900/90">
          {ctrl.paused ? (
            <button
              onClick={() => onResume(cam)}
              className="flex items-center gap-1.5 bg-green-600 hover:bg-green-500 text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors"
            >
              <Radio className="w-4 h-4" /> Go Live
            </button>
          ) : (
            <button
              onClick={() => onPause(cam)}
              className="flex items-center gap-1.5 bg-yellow-500 hover:bg-yellow-400 text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors"
            >
              <Pause className="w-4 h-4" /> Pause
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Site Grouped Camera Grid ──────────────────────────────────────────────────
function SiteGroupedCameras({ cameras, sites, expandedSites, setExpandedSites, isAdmin, camControls, onPause, onResume, onZoom }) {
  const siteNameMap = useMemo(() => {
    const map = {};
    for (const site of sites) map[site.site_id] = site.name;
    return map;
  }, [sites]);

  const grouped = useMemo(() => {
    const groups = {};
    for (const cam of cameras.filter(c => c.is_active)) {
      const sid = cam.site_id || '__unassigned__';
      if (!groups[sid]) groups[sid] = [];
      groups[sid].push(cam);
    }
    return groups;
  }, [cameras]);

  const siteIds = Object.keys(grouped);

  if (siteIds.length === 0) return <p className="text-slate-400">No active cameras.</p>;

  return (
    <div className="space-y-3">
      {siteIds.map(siteId => {
        const siteCameras = grouped[siteId];
        const siteName = siteId === '__unassigned__' ? 'Unassigned Cameras' : (siteNameMap[siteId] || siteId);
        const isExpanded = !!expandedSites[siteId];
        return (
          <div key={siteId} className="rounded-lg border border-sky-200 bg-white shadow-sm overflow-hidden">
            <button
              onClick={() => setExpandedSites(prev => ({ ...prev, [siteId]: !prev[siteId] }))}
              className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-sky-50 to-white hover:from-sky-100 transition-colors"
            >
              <div className="flex items-center gap-3">
                <MapPin className="w-5 h-5 text-sky-500" />
                <span className="font-semibold text-slate-700 text-base">{siteName}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-sky-100 text-sky-600 font-medium">
                  {siteCameras.length} {siteCameras.length === 1 ? 'camera' : 'cameras'}
                </span>
              </div>
              {isExpanded ? <ChevronDown className="w-5 h-5 text-slate-400" /> : <ChevronRight className="w-5 h-5 text-slate-400" />}
            </button>

            {isExpanded && (
              <div className="p-4 border-t border-sky-100">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {siteCameras.map(cam => (
                    <CameraCard
                      key={cam.camera_id}
                      cam={cam}
                      isAdmin={isAdmin}
                      ctrl={camControls[cam.camera_id] || { paused: false, flaggedSnap: null }}
                      onPause={onPause}
                      onResume={onResume}
                      onZoom={onZoom}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Individual Camera Card ────────────────────────────────────────────────────
function CameraCard({ cam, isAdmin, ctrl, onPause, onResume, onZoom }) {
  const streamSrc = `${getStreamUrl(cam.camera_id)}?ctx=dash`;

  return (
    <div className="bg-white rounded-lg overflow-hidden border border-slate-200 shadow-sm group">
      {/* Header bar */}
      <div className="p-2 bg-sky-50 flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700">{cam.name}</span>
        <span className={`text-xs px-2 py-0.5 rounded-full ${
          (typeof cam.health === 'object' ? cam.health?.status : cam.health) === 'running'
            ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
        }`}>
          {ctrl.paused ? 'Paused' : (typeof cam.health === 'object' ? cam.health?.status || 'unknown' : cam.health || 'unknown')}
        </span>
      </div>

      {/* Feed / flagged frame */}
      <div className="relative aspect-video bg-slate-900 cursor-pointer" onClick={() => onZoom(cam)}>
        {ctrl.paused && ctrl.flaggedSnap ? (
          <>
            <img src={ctrl.flaggedSnap} alt="Last flagged frame" className="w-full h-full object-contain" />
            <div className="absolute top-1.5 left-1.5 bg-red-600/90 text-white text-xs px-2 py-0.5 rounded font-medium">
              ⚠ Last Flagged
            </div>
          </>
        ) : isAdmin && cam.source_type === 'video' ? (
          <video
            src={`${EXPRESS_URL}/${cam.source_path.replace(/\\/g, '/')}`}
            autoPlay loop muted playsInline
            className="w-full h-full object-cover"
          />
        ) : (
          <img
            src={streamSrc}
            alt={cam.name}
            className="w-full h-full object-contain"
            onError={(e) => {
              setTimeout(() => { e.target.src = `${getStreamUrl(cam.camera_id)}?ctx=dash&retry=${Date.now()}`; }, 2000);
            }}
          />
        )}

        {/* Zoom hint overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
          <div className="bg-black/60 text-white text-xs px-3 py-1.5 rounded-full flex items-center gap-1.5">
            <Maximize2 className="w-3.5 h-3.5" /> Click to zoom
          </div>
        </div>

        {/* ── Playback controls — bottom right ── */}
        <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
          {ctrl.paused ? (
            <button
              onClick={(e) => { e.stopPropagation(); onResume(cam); }}
              className="flex items-center gap-1 bg-green-600/90 hover:bg-green-500 text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg shadow-lg backdrop-blur-sm transition-colors"
              title="Go Live — resume detection"
            >
              <Radio className="w-3.5 h-3.5" /> Go Live
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onPause(cam); }}
              className="flex items-center gap-1 bg-black/60 hover:bg-yellow-500 text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg shadow-lg backdrop-blur-sm transition-colors"
              title="Pause — show last flagged frame"
            >
              <Pause className="w-3.5 h-3.5" /> Pause
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KPICard({ icon: Icon, label, value, color }) {
  const colors = {
    blue: 'bg-sky-50 border-sky-200 text-sky-600',
    red: 'bg-red-50 border-red-200 text-red-600',
    green: 'bg-green-50 border-green-200 text-green-600',
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-600',
    purple: 'bg-purple-50 border-purple-200 text-purple-600',
  };
  return (
    <div className={`rounded-lg border p-4 shadow-sm ${colors[color]}`}>
      <div className="flex items-center gap-3">
        <Icon className="w-8 h-8" />
        <div>
          <p className="text-2xl font-bold text-slate-800">{value}</p>
          <p className="text-sm">{label}</p>
        </div>
      </div>
    </div>
  );
}
