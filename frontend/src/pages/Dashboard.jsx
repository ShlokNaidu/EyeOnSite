import React, { useState, useEffect, useMemo } from 'react';
import { getCameras, getAlerts, getStats, getStreamUrl, deleteAlert, getAdminUsers, getMySites, getCameraStatus } from '../services/api';
import { setCameraNames, getCameraName, getWorkerCount } from '../services/audioAlerts';
import { addAlertListener } from '../services/websocket';
import { resumeAudioContext } from '../services/audioAlerts';
import { Activity, AlertTriangle, Shield, Camera, Trash2, Users, ChevronDown, ChevronRight, MapPin } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';

export default function Dashboard() {
  const [cameras, setCameras] = useState([]);
  const [sites, setSites] = useState([]);
  const [expandedSites, setExpandedSites] = useState({});
  const [cameraStatus, setCameraStatus] = useState({});
  const [recentAlerts, setRecentAlerts] = useState([]);
  const [stats, setStats] = useState(null);
  const [adminCount, setAdminCount] = useState(0);
  const { t } = useLanguage();
  const { isAdmin, isSuperAdmin } = useAuth();
  const EXPRESS_URL = import.meta.env.VITE_EXPRESS_URL || 'http://localhost:5000';

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

  useEffect(() => {
    if (cameras.length === 0) return;
    cameras.forEach(async (cam) => {
      try {
        const res = await getCameraStatus(cam.camera_id);
        setCameraStatus((prev) => ({ ...prev, [cam.camera_id]: res.data }));
      } catch {}
    });
  }, [cameras]);

  async function loadData() {
    try {
      if (isSuperAdmin) {
        const usersRes = await getAdminUsers();
        const admins = (usersRes.data || []).filter(u => u.role === 'admin');
        setAdminCount(admins.length);
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
        setSites(sitesRes.data || []);
      }
    } catch (err) {
      console.error('Dashboard load error:', err);
    }
  }

  async function handleDeleteAlert(alert_id) {
    if (!confirm(t('confirm_delete') || 'Delete this alert?')) return;
    try {
      await deleteAlert(alert_id);
      setRecentAlerts(prev => prev.filter(a => a.alert_id !== alert_id));
    } catch (err) {
      console.error('Delete alert error:', err);
    }
  }

  if (isSuperAdmin) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-slate-800">{t('dashboard')} - Super Admin</h1>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <KPICard
            icon={Users}
            label="Total Active Admins"
            value={adminCount}
            color="purple"
          />
        </div>
        <div className="bg-white rounded-lg p-8 border border-slate-200 text-center text-slate-500 shadow-sm">
          Welcome to the Super Admin Dashboard. As the root administrator, you have an unrestricted system-wide view without being tied to specific sites.
          Use the <b>Users</b> tab in the sidebar to manage standard administrators and site data.
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
        <KPICard
          icon={Camera}
          label="Active Cameras"
          value={cameras.filter((c) => c.is_active).length}
          color="blue"
        />
        <KPICard
          icon={AlertTriangle}
          label="Total Alerts"
          value={stats?.total_alerts || 0}
          color="red"
        />
        <KPICard
          icon={Shield}
          label="Safety Score"
          value={stats?.safety_score ?? '—'}
          color="green"
        />
        <KPICard
          icon={Activity}
          label="Recent Alerts"
          value={
            recentAlerts.filter(
              (a) => new Date(a.timestamp).toDateString() === new Date().toDateString()
            ).length
          }
          color="yellow"
        />
      </div>

      {/* Live Streams — Grouped by Site */}
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
            EXPRESS_URL={EXPRESS_URL}
            cameraStatus={cameraStatus}
          />
        )}
      </div>

      {/* Recent Alerts — only shown for site officers */}
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
                    <span className="text-sm font-medium text-red-600">
                      {t(alert.type) || alert.type}
                    </span>
                    <span className="text-xs text-yellow-600 ml-2">
                      ({getWorkerCount(alert)} {getWorkerCount(alert) === 1 ? 'worker' : 'workers'})
                    </span>
                    <span className="text-xs text-slate-400 ml-3">
                      {t('camera')}: {alert.camera_name || getCameraName(alert.camera_id)}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-slate-400">
                      {new Date(alert.timestamp).toLocaleTimeString()}
                    </span>
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
    </div>
  );
}

function SiteGroupedCameras({ cameras, sites, expandedSites, setExpandedSites, isAdmin, EXPRESS_URL, cameraStatus }) {
  // Build a site name lookup
  const siteNameMap = useMemo(() => {
    const map = {};
    for (const site of sites) {
      map[site.site_id] = site.name;
    }
    return map;
  }, [sites]);

  // Group active cameras by site_id
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

  function toggleSite(siteId) {
    setExpandedSites(prev => ({ ...prev, [siteId]: !prev[siteId] }));
  }

  if (siteIds.length === 0) {
    return <p className="text-slate-400">No active cameras.</p>;
  }

  return (
    <div className="space-y-3">
      {siteIds.map(siteId => {
        const siteCameras = grouped[siteId];
        const siteName = siteId === '__unassigned__' ? 'Unassigned Cameras' : (siteNameMap[siteId] || siteId);
        const isExpanded = !!expandedSites[siteId];
        const activeCamCount = siteCameras.length;

        return (
          <div key={siteId} className="rounded-lg border border-sky-200 bg-white shadow-sm overflow-hidden">
            {/* Site Header (clickable) */}
            <button
              onClick={() => toggleSite(siteId)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-sky-50 to-white hover:from-sky-100 transition-colors"
            >
              <div className="flex items-center gap-3">
                <MapPin className="w-5 h-5 text-sky-500" />
                <span className="font-semibold text-slate-700 text-base">{siteName}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-sky-100 text-sky-600 font-medium">
                  {activeCamCount} {activeCamCount === 1 ? 'camera' : 'cameras'}
                </span>
              </div>
              {isExpanded
                ? <ChevronDown className="w-5 h-5 text-slate-400" />
                : <ChevronRight className="w-5 h-5 text-slate-400" />
              }
            </button>

            {/* Expanded camera grid */}
            {isExpanded && (
              <div className="p-4 border-t border-sky-100">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {siteCameras.map(cam => (
                    <div key={cam.camera_id} className="bg-white rounded-lg overflow-hidden border border-slate-200 shadow-sm">
                      <div className="p-2 bg-sky-50 flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-700">{cam.name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${(typeof cam.health === 'object' ? cam.health?.status : cam.health) === 'running'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-yellow-100 text-yellow-700'
                          }`}>
                          {typeof cam.health === 'object' ? cam.health?.status || 'unknown' : cam.health || 'unknown'}
                        </span>
                      </div>
                      <div className="relative">
                        {isAdmin && cam.source_type === 'video' ? (
                          <video
                            src={`${EXPRESS_URL}/${cam.source_path.replace(/\\/g, '/')}`}
                            autoPlay
                            loop
                            muted
                            playsInline
                            className="w-full aspect-video object-cover bg-slate-100"
                          />
                        ) : (
                          <img
                            src={`${getStreamUrl(cam.camera_id)}?ctx=dash`}
                            alt={cam.name}
                            className="w-full aspect-video object-contain bg-slate-100"
                            onError={(e) => {
                              setTimeout(() => {
                                e.target.src = `${getStreamUrl(cam.camera_id)}?ctx=dash&retry=${Date.now()}`;
                              }, 2000);
                            }}
                          />
                        )}
                        {cameraStatus[cam.camera_id]?.paused && (
                          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                            <span className="bg-yellow-500 text-white font-bold tracking-widest px-4 py-2 rounded-lg shadow-lg border border-yellow-600">
                              TRACKING PAUSED
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
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
