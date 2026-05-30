import React, { useState, useEffect } from 'react';
import { getHealth } from '../services/api';
import { Settings as SettingsIcon, Server, Cpu, Database, RefreshCw, Volume2, VolumeX, Globe } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

const EXPRESS_URL = import.meta.env.VITE_EXPRESS_URL || 'http://localhost:5000';
const PYTHON_URL = import.meta.env.VITE_PYTHON_STREAM_URL || 'http://localhost:8000';

export default function Settings() {
  const [backendHealth, setBackendHealth] = useState(null);
  const [aiHealth, setAiHealth] = useState(null);
  const [loading, setLoading] = useState(false);
  const { t, uiLang, setUiLang, voiceLang, setVoiceLang } = useLanguage();

  useEffect(() => {
    checkHealth();
  }, []);

  async function checkHealth() {
    setLoading(true);
    try {
      const res = await getHealth();
      setBackendHealth(res.data);
    } catch {
      setBackendHealth({ status: 'unreachable' });
    }

    try {
      const res = await fetch(`${PYTHON_URL}/health`);
      const data = await res.json();
      setAiHealth(data);
    } catch {
      setAiHealth({ status: 'unreachable' });
    }
    setLoading(false);
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6 text-slate-800">{t('settings')}</h1>

      {/* Language Settings */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-slate-700">
          <Globe className="w-5 h-5" />
          {t('app_language') || "Language & Region"}
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

      {/* Audio Alert Settings */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-4 text-slate-700">{t('notification_settings')}</h2>
        <div className="bg-white border border-sky-200 rounded-lg p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Volume2 className="w-5 h-5 text-sky-500" />
              <div>
                <p className="font-medium text-slate-700">{t('voice_alerts')}</p>
               </div>
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
      className={`relative w-12 h-6 rounded-full transition-colors ${
        voiceEnabled ? 'bg-sky-500' : 'bg-slate-300'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow-sm ${
          voiceEnabled ? 'translate-x-6' : 'translate-x-0'
        }`}
      />
    </button>
  );
}
