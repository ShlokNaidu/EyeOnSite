import React, { useState, useEffect } from 'react';
import { getStats, getCameras } from '../services/api';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { BarChart3, TrendingUp, Shield, AlertTriangle, MapPin } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const ALERT_LABELS = {
  helmet_missing: 'Helmet Missing',
  vest_missing: 'Vest Missing',
  restricted_zone: 'Restricted Zone',
  machinery_proximity: 'Machinery Proximity',
  predicted_machinery_collision: 'Predicted Collision',
  predicted_zone_entry: 'Predicted Zone Entry',
};

const PIE_COLORS = ['#ef4444', '#f97316', '#8b5cf6', '#eab308', '#f59e0b', '#06b6d4'];

export default function Analytics() {
  const [stats, setStats] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [timeFilter, setTimeFilter] = useState('today');
  const { isAdmin } = useAuth();

  useEffect(() => {
    loadCameras();
    loadStats();
  }, []);

  useEffect(() => {
    loadStats();
  }, [selectedCamera, timeFilter]);

  async function loadCameras() {
    try {
      const res = await getCameras();
      setCameras(res.data || []);
    } catch {}
  }

  async function loadStats() {
    try {
      const params = {};
      if (selectedCamera) params.camera_id = selectedCamera;
      if (timeFilter) params.time_filter = timeFilter;
      const res = await getStats(params);
      setStats(res.data || null);
    } catch (err) {
      console.error(err);
    }
  }

  const byTypeData = stats?.by_type
    ? Object.entries(stats.by_type).map(([key, value]) => ({
        name: ALERT_LABELS[key] || key,
        value,
      }))
    : [];

  const trendData = stats?.alerts_per_day || [];

  const scoreColor =
    (stats?.safety_score ?? 100) >= 75 ? 'text-green-500' :
    (stats?.safety_score ?? 100) >= 50 ? 'text-yellow-500' :
    'text-red-500';

  // Admin: simplified view with total + site-wise counts
  if (isAdmin) {
    const bySite = stats?.by_site || [];
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6 text-slate-800">Analytics</h1>

        {/* Time Filter only for admin */}
        <div className="flex items-center gap-4 mb-6">
          <select
            value={timeFilter}
            onChange={(e) => setTimeFilter(e.target.value)}
            className="bg-white border border-sky-200 rounded px-3 py-1.5 text-sm text-slate-700"
          >
            <option value="today">Today (IST)</option>
            <option value="last7days">Last 7 Days (IST)</option>
          </select>
        </div>

        {/* Total Alerts KPI */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-white border border-sky-200 rounded-lg p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-8 h-8 text-red-500" />
              <div>
                <p className="text-3xl font-bold text-slate-800">{stats?.total_alerts || 0}</p>
                <p className="text-sm text-slate-400">Total Alerts (All Sites)</p>
              </div>
            </div>
          </div>
        </div>

        {/* Site-wise Alert Counts */}
        <h2 className="text-lg font-semibold mb-3 text-slate-700">Alerts by Site</h2>
        {bySite.length === 0 ? (
          <p className="text-slate-400">No alerts found for the selected time period.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {bySite.map((site) => (
              <div
                key={site.site_id}
                className="bg-white border border-sky-200 rounded-lg p-5 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-sky-50 flex items-center justify-center">
                    <MapPin className="w-5 h-5 text-sky-500" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-slate-700">{site.site_name}</p>
                    <p className="text-2xl font-bold text-slate-800">{site.count}</p>
                    <p className="text-xs text-slate-400">{site.count === 1 ? 'alert' : 'alerts'}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Site officer: full analytics view
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6 text-slate-800">Analytics</h1>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <select
          value={selectedCamera}
          onChange={(e) => setSelectedCamera(e.target.value)}
          className="bg-white border border-sky-200 rounded px-3 py-1.5 text-sm text-slate-700"
        >
          <option value="">All Cameras</option>
          {cameras.map((c) => (
            <option key={c.camera_id} value={c.camera_id}>{c.name}</option>
          ))}
        </select>
        <select
          value={timeFilter}
          onChange={(e) => setTimeFilter(e.target.value)}
          className="bg-white border border-sky-200 rounded px-3 py-1.5 text-sm text-slate-700"
        >
          <option value="today">Today (IST)</option>
          <option value="last7days">Last 7 Days (IST)</option>
        </select>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-white border border-sky-200 rounded-lg p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-8 h-8 text-red-500" />
            <div>
              <p className="text-3xl font-bold text-slate-800">{stats?.total_alerts || 0}</p>
              <p className="text-sm text-slate-400">Total Alerts</p>
            </div>
          </div>
        </div>
        <div className="bg-white border border-sky-200 rounded-lg p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <Shield className={`w-8 h-8 ${scoreColor}`} />
            <div>
              <p className={`text-3xl font-bold ${scoreColor}`}>{stats?.safety_score ?? '—'}</p>
              <p className="text-sm text-slate-400">Safety Score</p>
            </div>
          </div>
        </div>
        <div className="bg-white border border-sky-200 rounded-lg p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <TrendingUp className="w-8 h-8 text-sky-500" />
            <div>
              <p className="text-3xl font-bold text-slate-800">{byTypeData.length}</p>
              <p className="text-sm text-slate-400">Violation Types</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Trend Line */}
        <div className="bg-white border border-sky-200 rounded-lg p-4 shadow-sm">
          <h3 className="font-semibold mb-4 text-slate-700">Alerts Over Time</h3>
          {trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0f2fe" />
                <XAxis 
                  dataKey="date" 
                  stroke="#64748b" 
                  fontSize={12} 
                  tickFormatter={(val) => {
                    if (!val) return '';
                    const [y, m, d] = val.split('-');
                    return `${d}-${m}-${y}`;
                  }}
                />
                <YAxis stroke="#64748b" fontSize={12} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #bae6fd', borderRadius: '8px' }}
                  labelStyle={{ color: '#1e293b' }}
                  labelFormatter={(val) => {
                    if (!val) return '';
                    const [y, m, d] = val.split('-');
                    return `${d}-${m}-${y} (IST)`;
                  }}
                />
                <Line type="monotone" dataKey="count" stroke="#0ea5e9" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-slate-400 text-center py-12">No trend data available.</p>
          )}
        </div>

        {/* Violation Breakdown Pie */}
        <div className="bg-white border border-sky-200 rounded-lg p-4 shadow-sm">
          <h3 className="font-semibold mb-4 text-slate-700">Violation Breakdown</h3>
          {byTypeData.length > 0 ? (
            <ResponsiveContainer width="100%" height={360}>
              <PieChart>
                <Pie
                  data={byTypeData}
                  cx="50%"
                  cy="45%"
                  innerRadius={50}
                  outerRadius={90}
                  dataKey="value"
                  label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
                  labelLine={true}
                  fontSize={12}
                >
                  {byTypeData.map((_, index) => (
                    <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #bae6fd', borderRadius: '8px' }}
                  formatter={(value, name) => [`${value} alerts`, name]}
                />
                <Legend
                  verticalAlign="bottom"
                  align="center"
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-slate-400 text-center py-12">No violation data.</p>
          )}
        </div>

        {/* Bar chart by type */}
        <div className="bg-white border border-sky-200 rounded-lg p-4 lg:col-span-2 shadow-sm">
          <h3 className="font-semibold mb-4 text-slate-700">Alerts by Type</h3>
          {byTypeData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={byTypeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0f2fe" />
                <XAxis dataKey="name" stroke="#64748b" fontSize={11} angle={-20} textAnchor="end" height={60} />
                <YAxis stroke="#64748b" fontSize={12} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #bae6fd', borderRadius: '8px' }}
                />
                <Bar dataKey="value" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-slate-400 text-center py-12">No data to display.</p>
          )}
        </div>
      </div>
    </div>
  );
}
