import React, { useState, useEffect, useMemo } from 'react';
import { getAlerts, getCameras, deleteAlert, clearAlerts, getMySites } from '../services/api';
import { addAlertListener } from '../services/websocket';
import { getCameraName, setCameraNames, getVoiceDescription, getWorkerCount } from '../services/audioAlerts';
import { Bell, Filter, Image, X, Trash2, Volume2, ChevronDown, ChevronRight, MapPin } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { resolveAlert } from '../services/api';
import ConfirmDialog from '../components/ConfirmDialog';
import { useAlertCount } from '../layouts/MainLayout';

const ALERT_COLORS = {
  helmet_missing: 'bg-red-100 text-red-600',
  vest_missing: 'bg-orange-100 text-orange-600',
  restricted_zone: 'bg-purple-100 text-purple-600',
  machinery_proximity: 'bg-yellow-100 text-yellow-600',
  predicted_machinery_collision: 'bg-amber-100 text-amber-600',
  predicted_zone_entry: 'bg-cyan-100 text-cyan-600',
  no_movement: 'bg-fuchsia-100 text-fuchsia-600',
  fall_no_movement: 'bg-rose-100 text-rose-700',
  proximity_ppe_violation: 'bg-pink-100 text-pink-600',
};

const ALERT_TYPES = [
  'helmet_missing', 'vest_missing', 'restricted_zone', 'machinery_proximity',
  'predicted_machinery_collision', 'predicted_zone_entry', 'no_movement',
  'fall_no_movement', 'proximity_ppe_violation',
];

const SEVERITIES = {
  helmet_missing: { label: 'Warning', color: 'bg-orange-100 text-orange-600 border border-orange-200' },
  vest_missing: { label: 'Warning', color: 'bg-orange-100 text-orange-600 border border-orange-200' },
  restricted_zone: { label: 'Critical', color: 'bg-red-100 text-red-600 border border-red-200' },
  machinery_proximity: { label: 'Critical', color: 'bg-red-100 text-red-600 border border-red-200' },
  predicted_machinery_collision: { label: 'Critical', color: 'bg-red-100 text-red-600 border border-red-200' },
  predicted_zone_entry: { label: 'Info', color: 'bg-sky-100 text-sky-600 border border-sky-200' },
  no_movement: { label: 'Warning', color: 'bg-orange-100 text-orange-600 border border-orange-200' },
  fall_no_movement: { label: 'Critical', color: 'bg-red-100 text-red-600 border border-red-200' },
  proximity_ppe_violation: { label: 'Warning', color: 'bg-orange-100 text-orange-600 border border-orange-200' },
};

const EXPRESS_URL = import.meta.env.VITE_EXPRESS_URL || 'http://localhost:5000';

export default function Alerts() {
  const [alerts, setAlerts] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [filters, setFilters] = useState({ camera_id: '', type: '', severity: '', limit: 50 });
  const [snapshotModal, setSnapshotModal] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sites, setSites] = useState([]);
  const [expandedSites, setExpandedSites] = useState({});
  const { t } = useLanguage();
  const { isAdmin } = useAuth();
  const { setAlertCount } = useAlertCount();

  // Reset badge count when user visits Alerts page
  useEffect(() => { setAlertCount(0); }, []);

  useEffect(() => {
    loadCameras();
    // Don't call loadAlerts() here — the filters useEffect handles initial load
    const remove = addAlertListener((msg) => {
      if (msg.event === 'new_alert') {
        setAlerts((prev) => [msg.data, ...prev].slice(0, 100));
      }
    });
    return remove;
  }, []);

  // Single source of truth: reload when filters change (including on initial render)
  // Reset page to 1 when filters change to avoid stale page state
  useEffect(() => {
    setPagination((p) => ({ ...p, page: 1 }));
  }, [filters.camera_id, filters.type, filters.severity, filters.limit]);

  // Reload when page changes (fixes stale-closure pagination bug)
  useEffect(() => {
    loadAlerts();
  }, [pagination.page]);

  async function loadCameras() {
    try {
      const [camRes, sitesRes] = await Promise.all([
        getCameras(),
        isAdmin ? getMySites().catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
      ]);
      const cams = camRes.data || [];
      setCameras(cams);
      setCameraNames(cams);
      setSites(sitesRes.data || []);
    } catch {}
  }

  async function loadAlerts() {
    try {
      const params = {};
      if (filters.camera_id) params.camera_id = filters.camera_id;
      if (filters.type) params.type = filters.type;
      if (filters.severity) params.severity = filters.severity;  // #6 — pass to API
      params.limit = filters.limit;
      params.page = pagination.page;

      const res = await getAlerts(params);
      setAlerts(res.data || []);
      if (res.pagination) setPagination((p) => ({ ...p, ...res.pagination }));
    } catch (err) {
      console.error(err);
    }
  }

  async function handleDeleteAlert(alert_id) {
    try {
      await deleteAlert(alert_id);
      setAlerts((prev) => prev.filter((a) => a.alert_id !== alert_id));
      setPagination((p) => ({ ...p, total: Math.max(0, p.total - 1) }));
    } catch (err) {
      console.error('Delete alert error:', err);
    }
  }

  async function handleResolve(alert_id) {
    try {
      await resolveAlert(alert_id, 'resolved');
      setAlerts(prev => prev.map(a => a.alert_id === alert_id ? { ...a, status: 'resolved' } : a));
    } catch (err) {
      console.error('Resolve alert error:', err);
    }
  }

  async function handleClearAll() {
    setConfirmOpen(true);
  }

  async function doClearAll() {
    setConfirmOpen(false);
    try {
      await clearAlerts(filters.camera_id || undefined);
      setAlerts([]);
      setPagination((p) => ({ ...p, total: 0, pages: 1 }));
    } catch (err) {
      console.error('Clear alerts error:', err);
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">{t('alerts')}</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-400">{pagination.total} {t('total_alerts')}</span>
          {alerts.length > 0 && (
            <button
              onClick={handleClearAll}
              className="flex items-center gap-1 bg-red-50 hover:bg-red-100 text-red-500 px-3 py-1.5 rounded-lg text-sm transition-colors border border-red-200"
            >
              <Trash2 className="w-3.5 h-3.5" /> {t('clear_all')}
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <Filter className="w-4 h-4 text-slate-400" />
        <select
          value={filters.camera_id}
          onChange={(e) => setFilters({ ...filters, camera_id: e.target.value })}
          className="bg-white border border-sky-200 rounded px-3 py-1.5 text-sm text-slate-700"
        >
          <option value="">All Cameras</option>
          {cameras.map((c) => (
            <option key={c.camera_id} value={c.camera_id}>{c.name}</option>
          ))}
        </select>
        <select
          value={filters.type}
          onChange={(e) => setFilters({ ...filters, type: e.target.value })}
          className="bg-white border border-sky-200 rounded px-3 py-1.5 text-sm text-slate-700"
        >
          <option value="">All Types</option>
          {ALERT_TYPES.map((typeKey) => (
            <option key={typeKey} value={typeKey}>{t(typeKey)}</option>
          ))}
        </select>
        <select
          value={filters.severity}
          onChange={(e) => setFilters({ ...filters, severity: e.target.value })}
          className="bg-white border border-sky-200 rounded px-3 py-1.5 text-sm text-slate-700"
        >
          <option value="">All Severities</option>
          <option value="Critical">Critical</option>
          <option value="Warning">Warning</option>
          <option value="Info">Info</option>
        </select>
      </div>

      {/* Alert list */}
      {alerts.length === 0 ? (
        <div className="text-center text-slate-400 py-12">
          <Bell className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>{t('no_alerts')}</p>
        </div>
      ) : isAdmin ? (
        <SiteGroupedAlerts
          alerts={alerts.filter(a => !filters.severity || (SEVERITIES[a.type]?.label === filters.severity))}
          cameras={cameras}
          sites={sites}
          expandedSites={expandedSites}
          setExpandedSites={setExpandedSites}
          isAdmin={isAdmin}
          t={t}
          snapshotModal={snapshotModal}
          setSnapshotModal={setSnapshotModal}
          handleDeleteAlert={handleDeleteAlert}
          handleResolve={handleResolve}
        />
      ) : (
        <AlertTable
          alerts={alerts.filter(a => !filters.severity || (SEVERITIES[a.type]?.label === filters.severity))}
          isAdmin={isAdmin}
          t={t}
          setSnapshotModal={setSnapshotModal}
          handleDeleteAlert={handleDeleteAlert}
          handleResolve={handleResolve}
        />
      )}

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          {Array.from({ length: pagination.pages }, (_, i) => i + 1).slice(0, 10).map((page) => (
            <button
              key={page}
              onClick={() => setPagination((p) => ({ ...p, page }))}
              className={`px-3 py-1 rounded text-sm ${
                page === pagination.page
                  ? 'bg-sky-500 text-white'
                  : 'bg-white text-slate-600 hover:bg-sky-50 border border-sky-200'
              }`}
            >
              {page}
            </button>
          ))}
        </div>
      )}

      {/* Clear All Confirm Dialog */}
      <ConfirmDialog
        isOpen={confirmOpen}
        title="Delete all alerts?"
        message="This will permanently delete all visible alerts. This cannot be undone."
        onConfirm={doClearAll}
        onCancel={() => setConfirmOpen(false)}
      />

      {/* Snapshot Modal */}
      {snapshotModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setSnapshotModal(null)}>
          <div className="relative max-w-3xl max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setSnapshotModal(null)}
              className="absolute -top-3 -right-3 bg-white rounded-full p-1 hover:bg-sky-50 shadow-md"
            >
              <X className="w-5 h-5 text-slate-600" />
            </button>
            <img
              src={`${EXPRESS_URL}${snapshotModal}`}
              alt="Incident snapshot"
              className="max-w-full max-h-[80vh] rounded-lg"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function AlertTable({ alerts, isAdmin, t, setSnapshotModal, handleDeleteAlert, handleResolve }) {
  return (
    <div className="bg-white border border-sky-200 rounded-lg overflow-hidden shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-sky-50">
          <tr>
            <th className="text-left p-3 text-slate-500 font-medium">Severity</th>
            <th className="text-left p-3 text-slate-500 font-medium">{t('type')}</th>
            <th className="text-left p-3 text-slate-500 font-medium">{t('camera')}</th>
            <th className="text-left p-3 text-slate-500 font-medium">{t('voice_alert')}</th>
            <th className="text-left p-3 text-slate-500 font-medium">{t('time')}</th>
            <th className="text-left p-3 text-slate-500 font-medium">{t('snapshot')}</th>
            <th className="text-left p-3 text-slate-500 font-medium">Status</th>
            <th className="text-left p-3 text-slate-500 font-medium"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-sky-100">
          {alerts.map((alert) => {
            const sev = SEVERITIES[alert.type] || { label: 'Unknown', color: 'bg-slate-100 text-slate-500' };
            return (
              <tr key={alert.alert_id} className="hover:bg-sky-50/50 transition-colors">
                <td className="p-3">
                  <span className={`text-xs px-2 py-1 rounded-full ${sev.color}`}>{sev.label}</span>
                </td>
                <td className="p-3">
                  <span className={`text-xs px-2 py-1 rounded-full ${ALERT_COLORS[alert.type] || 'bg-slate-100 text-slate-500'}`}>
                    {t(alert.type) || alert.type}
                  </span>
                  <span className="ml-2 text-xs text-slate-500">
                    {getWorkerCount(alert)} {getWorkerCount(alert) === 1 ? 'worker' : 'workers'}
                  </span>
                </td>
                <td className="p-3 text-slate-600">{alert.camera_name || getCameraName(alert.camera_id)}</td>
                <td className="p-3">
                  <span className="text-xs text-amber-600 flex items-center gap-1">
                    <Volume2 className="w-3.5 h-3.5" />
                    {getVoiceDescription(alert)}
                  </span>
                </td>
                <td className="p-3 text-slate-400">{new Date(alert.timestamp).toLocaleString()}</td>
                <td className="p-3">
                  {alert.snapshot_url ? (
                    <button onClick={() => setSnapshotModal(alert.snapshot_url)} className="text-sky-500 hover:text-sky-600 flex items-center gap-1">
                      <Image className="w-4 h-4" /> View
                    </button>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      alert.status === 'resolved' ? 'bg-green-100 text-green-700' :
                      alert.status === 'acknowledged' ? 'bg-blue-100 text-blue-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {alert.status || 'pending'}
                    </span>
                    {!isAdmin && alert.status !== 'resolved' && (
                      <button onClick={() => handleResolve(alert.alert_id)} className="text-xs bg-green-500 hover:bg-green-600 text-white px-2 py-1 rounded transition-colors">
                        Resolve
                      </button>
                    )}
                  </div>
                </td>
                <td className="p-3">
                  <button onClick={() => handleDeleteAlert(alert.alert_id)} className="text-red-400 hover:text-red-600 p-1" title="Delete alert">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SiteGroupedAlerts({ alerts, cameras, sites, expandedSites, setExpandedSites, isAdmin, t, setSnapshotModal, handleDeleteAlert, handleResolve }) {
  // Build camera_id → site_id lookup
  const cameraSiteMap = useMemo(() => {
    const map = {};
    for (const cam of cameras) {
      map[cam.camera_id] = cam.site_id || '__unassigned__';
    }
    return map;
  }, [cameras]);

  // Build site_id → site name lookup
  const siteNameMap = useMemo(() => {
    const map = {};
    for (const site of sites) {
      map[site.site_id] = site.name;
    }
    return map;
  }, [sites]);

  // Group alerts by site
  const grouped = useMemo(() => {
    const groups = {};
    for (const alert of alerts) {
      const siteId = cameraSiteMap[alert.camera_id] || '__unassigned__';
      if (!groups[siteId]) groups[siteId] = [];
      groups[siteId].push(alert);
    }
    return groups;
  }, [alerts, cameraSiteMap]);

  const siteIds = Object.keys(grouped);

  function toggleSite(siteId) {
    setExpandedSites(prev => ({ ...prev, [siteId]: !prev[siteId] }));
  }

  if (siteIds.length === 0) {
    return (
      <div className="text-center text-slate-400 py-12">
        <Bell className="w-12 h-12 mx-auto mb-3 opacity-50" />
        <p>{t('no_alerts')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {siteIds.map(siteId => {
        const siteAlerts = grouped[siteId];
        const siteName = siteId === '__unassigned__' ? 'Unassigned' : (siteNameMap[siteId] || siteId);
        const isExpanded = !!expandedSites[siteId];
        const criticalCount = siteAlerts.filter(a => SEVERITIES[a.type]?.label === 'Critical').length;
        const warningCount = siteAlerts.filter(a => SEVERITIES[a.type]?.label === 'Warning').length;

        return (
          <div key={siteId} className="rounded-lg border border-sky-200 bg-white shadow-sm overflow-hidden">
            <button
              onClick={() => toggleSite(siteId)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-sky-50 to-white hover:from-sky-100 transition-colors"
            >
              <div className="flex items-center gap-3">
                <MapPin className="w-5 h-5 text-sky-500" />
                <span className="font-semibold text-slate-700 text-base">{siteName}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-sky-100 text-sky-600 font-medium">
                  {siteAlerts.length} {siteAlerts.length === 1 ? 'alert' : 'alerts'}
                </span>
                {criticalCount > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-medium">
                    {criticalCount} critical
                  </span>
                )}
                {warningCount > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-600 font-medium">
                    {warningCount} warning
                  </span>
                )}
              </div>
              {isExpanded
                ? <ChevronDown className="w-5 h-5 text-slate-400" />
                : <ChevronRight className="w-5 h-5 text-slate-400" />
              }
            </button>

            {isExpanded && (
              <div className="border-t border-sky-100">
                <AlertTable
                  alerts={siteAlerts}
                  isAdmin={isAdmin}
                  t={t}
                  setSnapshotModal={setSnapshotModal}
                  handleDeleteAlert={handleDeleteAlert}
                  handleResolve={handleResolve}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
