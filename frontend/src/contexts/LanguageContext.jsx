import React, { createContext, useState, useContext, useEffect } from 'react';

const LanguageContext = createContext();

export function useLanguage() {
  return useContext(LanguageContext);
}

const UI_TRANSLATIONS = {
  en: {
    dashboard: "Dashboard",
    cameras: "Cameras",
    zones: "Zones",
    alerts: "Alerts",
    analytics: "Analytics",
    settings: "Settings",
    service_status: "Service Status",
    configuration: "Configuration",
    notification_settings: "Notification Settings",
    voice_alerts: "Voice Alerts",
    voice_language: "Voice Language",
    app_language: "App Language",
    add_camera: "Add Camera",
    total_alerts: "total alerts",
    clear_all: "Clear All",
    no_alerts: "No alerts found.",
    worker_down: "Worker Down",
    helmet_missing: "Helmet Missing",
    vest_missing: "Vest Missing",
    restricted_zone: "Restricted Zone",
    machinery_proximity: "Machinery Proximity",
    predicted_collision: "Predicted Collision",
    predicted_zone: "Predicted Zone Entry",
    camera_name: "Camera Name",
    source_type: "Source Type",
    register_camera: "Register Camera",
    active: "Active",
    paused: "Paused",
    stopped: "Stopped",
    activate: "Activate",
    pause: "Pause",
    stop: "Stop",
    zone_name: "Zone Name",
    zone_type: "Zone Type",
    save_zone: "Save Zone",
    safe_zone: "Safe Zone",
    type: "Type",
    camera: "Camera",
    time: "Time",
    snapshot: "Snapshot",
    voice_alert: "Voice Alert"
  },
  hi: {
    dashboard: "डैशबोर्ड",
    cameras: "कैमरे",
    zones: "सुरक्षा क्षेत्र",
    alerts: "चेतावनी",
    analytics: "एनालिटिक्स",
    settings: "सेटिंग्स",
    service_status: "सेवा की स्थिति",
    configuration: "कॉन्फ़िगरेशन",
    notification_settings: "सूचना सेटिंग्स",
    voice_alerts: "वॉयस अलर्ट सक्षम करें",
    voice_language: "वॉयस भाषा",
    app_language: "ऐप की भाषा",
    add_camera: "कैमरा जोड़ें",
    total_alerts: "कुल चेतावनी",
    clear_all: "सभी साफ़ करें",
    no_alerts: "कोई चेतावनी नहीं मिली।",
    worker_down: "कर्मचारी गिर गया है",
    helmet_missing: "हेलमेट नहीं है",
    vest_missing: "जैकेट नहीं है",
    restricted_zone: "प्रतिबंधित क्षेत्र",
    machinery_proximity: "मशीनरी के पास",
    predicted_collision: "संभावित टकराव",
    predicted_zone: "संभावित क्षेत्र प्रवेश",
    camera_name: "कैमरे का नाम",
    source_type: "स्रोत प्रकार",
    register_camera: "कैमरा रजिस्टर करें",
    active: "सक्रिय",
    paused: "विराम",
    stopped: "रुका हुआ",
    activate: "सक्रिय करें",
    pause: "रोकें",
    stop: "रुकें",
    zone_name: "क्षेत्र का नाम",
    zone_type: "क्षेत्र का प्रकार",
    save_zone: "क्षेत्र सहेजें",
    safe_zone: "सुरक्षित क्षेत्र",
    type: "प्रकार",
    camera: "कैमरा",
    time: "समय",
    snapshot: "स्नैपशॉट",
    voice_alert: "वॉयस चेतावनी"
  }
};

export function LanguageProvider({ children }) {
  const [uiLang, setUiLang] = useState(localStorage.getItem('uiLang') || 'en');
  const [voiceLang, setVoiceLang] = useState(localStorage.getItem('voiceLang') || 'en');
  const [voiceEnabled, setVoiceEnabled] = useState(localStorage.getItem('voiceEnabled') !== 'false');

  useEffect(() => {
    localStorage.setItem('uiLang', uiLang);
  }, [uiLang]);

  useEffect(() => {
    localStorage.setItem('voiceLang', voiceLang);
  }, [voiceLang]);

  useEffect(() => {
    localStorage.setItem('voiceEnabled', voiceEnabled.toString());
  }, [voiceEnabled]);

  const t = (key) => {
    return UI_TRANSLATIONS[uiLang]?.[key] || UI_TRANSLATIONS['en'][key] || key;
  };

  return (
    <LanguageContext.Provider value={{
      uiLang, setUiLang,
      voiceLang, setVoiceLang,
      voiceEnabled, setVoiceEnabled,
      t
    }}>
      {children}
    </LanguageContext.Provider>
  );
}
