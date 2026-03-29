import React, { useState, useEffect, createContext, useContext } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';

// Context so child pages (e.g. Alerts) can reset the badge count
export const AlertCountContext = createContext({ setAlertCount: () => {} });
export const useAlertCount = () => useContext(AlertCountContext);
import {
  LayoutDashboard,
  Camera,
  ShieldAlert,
  Bell,
  BarChart3,
  Settings,
  X,
  Volume2,
  LogOut,
  User,
  Users,
  Building2,
} from 'lucide-react';
import { addAlertListener } from '../services/websocket';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';

const NAV_ITEMS = [
  { to: '/dashboard', icon: LayoutDashboard, labelKey: 'dashboard' },
  { to: '/cameras', icon: Camera, labelKey: 'cameras' },
  { to: '/zones', icon: ShieldAlert, labelKey: 'zones' },
  { to: '/alerts', icon: Bell, labelKey: 'alerts' },
  { to: '/analytics', icon: BarChart3, labelKey: 'analytics' },
  { to: '/settings', icon: Settings, labelKey: 'settings' },
  { to: '/users', icon: Users, labelKey: 'users' },
];

export default function MainLayout() {
  const [toasts, setToasts] = useState([]);
  const [alertCount, setAlertCount] = useState(0);
  const { t } = useLanguage();
  const { user, logoutUser, isAdmin, isSuperAdmin } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isSuperAdmin) return;

    const remove = addAlertListener((msg) => {
      if (msg.event === 'new_alert') {
        const alert = msg.data;

        // For site_officers, only show toasts for their site
        if (user && user.role === 'site_officer' && alert.site_id && alert.site_id !== user.siteId) {
          return;
        }

        setAlertCount((c) => c + 1);

        // Add toast
        const id = Date.now();
        setToasts((prev) => [
          ...prev.slice(-4), // Keep max 5
          { id, alert },
        ]);

        // Play audio alert only for site officers — reuse a single AudioContext
        if (user && user.role === 'site_officer') {
          try {
            if (!window.__eosBellCtx) {
              window.__eosBellCtx = new window.AudioContext();
            }
            const ctx = window.__eosBellCtx;
            if (ctx.state === 'suspended') ctx.resume();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 800;
            gain.gain.value = 0.3;
            osc.start();
            osc.stop(ctx.currentTime + 0.2);
          } catch { }
        }

        // Auto-remove toast after 5s
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 5000);
      }
    });
    return remove;
  }, [user, isSuperAdmin]);

  function handleLogout() {
    logoutUser();
    navigate('/login');
  }

  return (
    <AlertCountContext.Provider value={{ setAlertCount }}>
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-sky-200 flex flex-col shadow-sm">
        <div className="p-3 border-b border-sky-200">
          <img src="/logo_1.png" alt="EyeOnSite" className="w-full h-auto object-contain rounded" />
        </div>
        <nav className="flex-1 p-2">
          {NAV_ITEMS.filter(item => {
            if (isSuperAdmin) {
              return item.to === '/dashboard' || item.to === '/users';
            }
            if (isAdmin) {
              return item.to === '/dashboard' || item.to === '/alerts' || item.to === '/users' || item.to === '/analytics';
            }
            // Site officer: all tabs
            return true;
          }).map(({ to, icon: Icon, labelKey }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/dashboard'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 transition-colors ${isActive
                  ? 'bg-sky-500 text-white'
                  : 'text-slate-600 hover:bg-sky-50 hover:text-sky-600'
                }`
              }
            >
              <Icon className="w-5 h-5" />
              <span>{t(labelKey) || (labelKey === 'users' ? 'Users' : labelKey)}</span>
              {labelKey === 'alerts' && alertCount > 0 && (
                <span className="ml-auto bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">
                  {alertCount > 99 ? '99+' : alertCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* User info + logout */}
        <div className="p-3 border-t border-sky-200">
          {user && (
            <div className="mb-2">
              <div className="flex items-center gap-2 mb-1">
                <User className="w-4 h-4 text-slate-400" />
                <span className="text-sm font-medium text-slate-700 truncate">{user.fullName}</span>
              </div>
              <div className="flex items-center gap-2 mb-1">
                <Building2 className="w-4 h-4 text-slate-400" />
                <span className="text-xs text-slate-400 truncate">{user.siteName || 'All Sites'}</span>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full ${isSuperAdmin ? 'bg-amber-100 text-amber-700' : isAdmin ? 'bg-purple-100 text-purple-600' : 'bg-sky-100 text-sky-600'
                }`}>
                {isSuperAdmin ? 'Super Admin' : isAdmin ? 'Admin' : 'Site Officer'}
              </span>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-red-500 hover:bg-red-50 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </div>

        <div className="px-4 py-2 border-t border-sky-200 text-xs text-slate-400">
          v2.1 • AI-Powered Safety
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-sky-50">
        <Outlet />
      </main>

      {/* Toast notifications */}
      <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm">
        {toasts.map((toastItem) => (
          <div
            key={toastItem.id}
            className="bg-red-50 border border-red-300 rounded-lg p-3 shadow-lg backdrop-blur animate-slide-in flex items-start gap-2"
          >
            <Volume2 className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-red-700">
                {t(toastItem.alert.type) || toastItem.alert.type}
              </p>
              <p className="text-xs text-red-500 mt-0.5">
                {t('camera')}: {toastItem.alert.camera_name || toastItem.alert.camera_id}
              </p>
            </div>
            <button
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== toastItem.id))}
              className="text-red-400 hover:text-red-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
    </AlertCountContext.Provider>
  );
}
