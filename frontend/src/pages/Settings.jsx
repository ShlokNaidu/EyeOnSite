import React, { useState, useEffect } from 'react';
import { getHealth } from '../services/api';
import { Settings as SettingsIcon, Globe, Volume2, RefreshCw } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

const PYTHON_URL = import.meta.env.VITE_PYTHON_STREAM_URL || 'http://localhost:8000';

function StatusDot({ ok, label }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-2.5 h-2.5 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`} />
      <span className="text-sm text-slate-600">{label}</span>
      <span className={`text-xs font-medium ${ok ? 'text-green-600' : 'text-red-500'}`}>
        {ok ? 'Online' : 'Offline'}
      </span>
    </div>
  );
}

export default function Settings() {
  const [backendOk, setBackendOk] = useState(null);
  const [aiOk, setAiOk] = useState(null);
  const [checking, setChecking] = useState(false);
  const { t, uiLang, setUiLang, voiceLang, setVoiceLang } = useLanguage();

  useEffect(() => { checkHealth(); }, []);

  async function checkHealth() {
    setChecking(true);
    try {
      await getHealth();
      setBackendOk(true);
    } catch {
      setBackendOk(false);
    }
    try {
      const res = await fetch(`${PYTHON_URL}/health`);
      setAiOk(res.ok);
    } catch {
      setAiOk(false);
    }
    setChecking(false);
  }

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6 text-slate-800">{t('settings')}</h1>

      {/* System Status */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-slate-700">System Status</h2>
          <button
            onClick={checkHealth}
            disabled={checking}
            className="flex items-center gap-1 text-xs text-sky-500 hover:text-sky-700 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
        <div className="bg-white border border-sky-200 rounded-lg p-4 shadow-sm space-y-3">
          {backendOk === null ? (
            <p className="text-sm text-slate-400">Checking…</p>
          ) : (
            <>
              <StatusDot ok={backendOk} label="Backend Server" />
              <StatusDot ok={aiOk} label="AI Detection Service" />
            </>
          )}
        </div>
      </div>

      {/* Language */}
      <div className="mb-8">
        <h2 className="text-base font-semibold mb-3 flex items-center gap-2 text-slate-700">
          <Globe className="w-4 h-4" />
          {t('app_language') || 'Language'}
        </h2>
        <div className="bg-white border border-sky-200 rounded-lg p-4 grid grid-cols-1 md:grid-cols-2 gap-4 shadow-sm">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-2">{t('app_language')}</label>
            <select
              value={uiLang}
              onChange={(e) => setUiLang(e.target.value)}
              className="bg-sky-50 border border-sky-200 rounded px-3 py-2 text-slate-700 w-full"
            >
              <option value="en">English</option>
              <option value="hi">हिन्दी (Hindi)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-2">{t('voice_language')}</label>
            <select
              value={voiceLang}
              onChange={(e) => setVoiceLang(e.target.value)}
              className="bg-sky-50 border border-sky-200 rounded px-3 py-2 text-slate-700 w-full"
            >
              <option value="en">English Voice</option>
              <option value="hi">हिन्दी (Hindi) Voice</option>
            </select>
          </div>
        </div>
      </div>

      {/* Audio */}
      <div className="mb-8">
        <h2 className="text-base font-semibold mb-3 text-slate-700">{t('notification_settings')}</h2>
        <div className="bg-white border border-sky-200 rounded-lg p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Volume2 className="w-5 h-5 text-sky-500" />
              <p className="font-medium text-sm text-slate-700">{t('voice_alerts')}</p>
            </div>
            <AudioToggle />
          </div>
        </div>
      </div>
    </div>
  );
}

function AudioToggle() {
  const { voiceEnabled, setVoiceEnabled } = useLanguage();
  return (
    <button
      onClick={() => setVoiceEnabled(!voiceEnabled)}
      className={`relative w-12 h-6 rounded-full transition-colors ${voiceEnabled ? 'bg-sky-500' : 'bg-slate-300'}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow-sm ${voiceEnabled ? 'translate-x-6' : 'translate-x-0'}`}
      />
    </button>
  );
}
