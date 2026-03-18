import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getCameras, createCamera, deleteCamera, activateCamera, pauseCamera, getCameraStatus, uploadVideo, getStreamUrl, createZone, getZones, deleteZone } from '../services/api';
import { Camera, Plus, Trash2, Play, Upload, Wifi, Video, ShieldAlert, ChevronRight, Check } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import CalibrationModal from '../components/CalibrationModal';

const ZONE_COLORS = {
  restricted: { fill: 'rgba(239,68,68,0.25)', stroke: '#ef4444' },
  proximity: { fill: 'rgba(249,115,22,0.25)', stroke: '#f97316' },
  safe: { fill: 'rgba(34,197,94,0.25)', stroke: '#22c55e' },
};

export default function Cameras() {
  const [cameras, setCameras] = useState([]);
  const [cameraStatus, setCameraStatus] = useState({}); // { [camera_id]: { status, paused } }
  const [calibratingCamera, setCalibratingCamera] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [step, setStep] = useState(1); // 1 = camera details, 2 = zone drawing
  const [form, setForm] = useState({ name: '', source_type: 'live', source_path: '0' });
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  // Zone drawing state (step 2)
  const [newCameraId, setNewCameraId] = useState('');
  const [pendingZones, setPendingZones] = useState([]);
  const [polygonPts, setPolygonPts] = useState([]);
  const [mousePos, setMousePos] = useState(null);
  const [zoneType, setZoneType] = useState('restricted');
  const [zoneName, setZoneName] = useState('');
  const [zoneRules, setZoneRules] = useState({ helmet_required: true, vest_required: true });
  const setupCameraIdRef = useRef('');
  const [streamSize, setStreamSize] = useState({ w: 640, h: 480 });
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const { t } = useLanguage();

  useEffect(() => {
    loadCameras();
  }, []);

  useEffect(() => {
    setupCameraIdRef.current = newCameraId;
  }, [newCameraId]);

  // Fetch status for all cameras after loading
  useEffect(() => {
    if (cameras.length === 0) return;
    cameras.forEach(async (cam) => {
      try {
        const res = await getCameraStatus(cam.camera_id);
        setCameraStatus((prev) => ({ ...prev, [cam.camera_id]: res.data }));
      } catch {}
    });
  }, [cameras]);
  async function handlePause(camera_id) {
    try {
      await pauseCamera(camera_id);
      await loadCameras();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleResume(camera_id) {
    try {
      await activateCamera(camera_id);
      await loadCameras();
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadCameras() {
    try {
      const res = await getCameras();
      setCameras(res.data || []);
    } catch (err) {
      console.error('Load cameras error:', err);
    }
  }

  function resetForm() {
    setShowForm(false);
    setStep(1);
    setForm({ name: '', source_type: 'live', source_path: '0' });
    setNewCameraId('');
    setupCameraIdRef.current = '';
    setPendingZones([]);
    setPolygonPts([]);
    setMousePos(null);
    setZoneType('restricted');
    setZoneName('');
    setZoneRules({ helmet_required: true, vest_required: true });
    setStreamSize({ w: 640, h: 480 });
    setError('');
  }

  async function handleCreateCamera(e) {
    e.preventDefault();
    setError('');
    try {
      const res = await createCamera(form);
      const camId = res.data?.camera_id;
      if (camId) {
        setNewCameraId(camId);
        setStep(2);
      } else {
        resetForm();
        await loadCameras();
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleFinish() {
    try {
      await activateCamera(newCameraId);
    } catch (err) {
      console.error('Activate error:', err);
    }
    resetForm();
    await loadCameras();
  }

  async function handleSkipZones() {
    try {
      await activateCamera(newCameraId);
    } catch (err) {
      console.error('Activate error:', err);
    }
    resetForm();
    await loadCameras();
  }

  async function handleDelete(camera_id) {
    if (!confirm('Delete this camera?')) return;
    try {
      await deleteCamera(camera_id);
      await loadCameras();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadVideo(file);
      setForm((f) => ({ ...f, source_path: res.data.source_path, source_type: 'video' }));
    } catch (err) {
      setError(err.message);
    }
    setUploading(false);
  }

  // --- Zone drawing helpers ---
  function getCanvasCoords(e) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = streamSize.w / rect.width;
    const scaleY = streamSize.h / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    };
  }

  function handleCanvasClick(e) {
    const coords = getCanvasCoords(e);
    
    if (polygonPts.length >= 6) {
      const startX = polygonPts[0];
      const startY = polygonPts[1];
      const dist = Math.sqrt(Math.pow(coords.x - startX, 2) + Math.pow(coords.y - startY, 2));
      
      if (dist < 15) {
        handleSaveZone();
        return;
      }
    }
    
    if (polygonPts.length >= 20) {
      alert(t('max_10_vertices') || 'Maximum 10 vertices allowed per polygon');
      return;
    }
    
    setPolygonPts([...polygonPts, coords.x, coords.y]);
  }

  function handleMouseMove(e) {
    setMousePos(getCanvasCoords(e));
  }

  async function handleSaveZone() {
    if (polygonPts.length < 6) return;
    try {
      const res = await createZone({
        camera_id: newCameraId,
        name: zoneName,
        zone_type: zoneType,
        coordinates: polygonPts,
        rules: { ...zoneRules },
      });
      setPolygonPts([]);
      setZoneName('');
      const zonesRes = await getZones(newCameraId);
      setPendingZones(zonesRes.data?.zones || []);
    } catch (err) {
      setError(err.message);
    }
  }

  function handleCancelZone() {
    setPolygonPts([]);
  }


  async function handleDeletePendingZone(zone_id) {
    try {
      await deleteZone(zone_id);
      const zonesRes = await getZones(newCameraId);
      setPendingZones(zonesRes.data?.zones || []);
    } catch (err) {
      setError(err.message);
    }
  }

  // Draw zones on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || step !== 2) return;
    const ctx = canvas.getContext('2d');
    canvas.width = streamSize.w;
    canvas.height = streamSize.h;
    ctx.clearRect(0, 0, streamSize.w, streamSize.h);

    pendingZones.forEach((zone) => {
      const coords = zone.coordinates;
      if (coords.length >= 6) {
        const colors = ZONE_COLORS[zone.zone_type] || ZONE_COLORS.restricted;
        ctx.fillStyle = colors.fill;
        ctx.beginPath();
        ctx.moveTo(coords[0], coords[1]);
        for (let i = 2; i < coords.length; i += 2) {
          ctx.lineTo(coords[i], coords[i+1]);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = colors.stroke;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = colors.stroke;
        ctx.font = '12px sans-serif';
        const labelText = zone.name || zone.zone_id || zone.zone_type;
        ctx.fillText(labelText, coords[0] + 4, coords[1] + 14);
      } else if (coords.length === 4) {
        // Fallback drawing for old rects
        const [x1, y1, x2, y2] = coords;
        const colors = ZONE_COLORS[zone.zone_type];
        ctx.strokeStyle = colors.stroke;
        ctx.strokeRect(x1, y1, x2-x1, y2-y1);
      }
    });

    if (polygonPts.length > 0) {
      const colors = ZONE_COLORS[zoneType];
      ctx.strokeStyle = colors.stroke;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(polygonPts[0], polygonPts[1]);
      for (let i = 2; i < polygonPts.length; i += 2) {
        ctx.lineTo(polygonPts[i], polygonPts[i+1]);
      }
      if (mousePos) {
        ctx.lineTo(mousePos.x, mousePos.y);
      }
      ctx.stroke();

      // Draw dots
      ctx.fillStyle = colors.stroke;
      for (let i = 0; i < polygonPts.length; i += 2) {
        ctx.beginPath();
        let radius = 4;
        if (i === 0 && polygonPts.length >= 6 && mousePos) {
          const dist = Math.sqrt(Math.pow(mousePos.x - polygonPts[0], 2) + Math.pow(mousePos.y - polygonPts[1], 2));
          if (dist < 15) radius = 8; // Highlight start node
        }
        ctx.arc(polygonPts[i], polygonPts[i+1], radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [pendingZones, polygonPts, mousePos, zoneType, streamSize, step]);

  const sourceIcons = { live: Camera, rtsp: Wifi, video: Video };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">{t('cameras')}</h1>
        {!showForm && (
          <button
            onClick={() => { setShowForm(true); setStep(1); }}
            className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" /> {t('add_camera')}
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-300 text-red-600 p-3 rounded-lg mb-4">
          {error}
        </div>
      )}

      {/* --- STEP 1: Camera details form --- */}
      {showForm && step === 1 && (
        <form onSubmit={handleCreateCamera} className="bg-white border border-sky-200 rounded-lg p-4 mb-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <span className="flex items-center justify-center w-7 h-7 rounded-full bg-sky-500 text-white text-sm font-bold">1</span>
            <h3 className="font-semibold text-slate-700">Camera Details</h3>
            <span className="text-xs text-slate-400 ml-auto">Step 1 of 2</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-slate-500 mb-1">Camera Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. North Gate Cam"
                className="w-full bg-sky-50 border border-sky-200 rounded px-3 py-2 text-slate-700"
                required
                minLength={3}
                maxLength={80}
              />
            </div>
            <div>
              <label className="block text-sm text-slate-500 mb-1">Source Type</label>
              <select
                value={form.source_type}
                onChange={(e) => {
                  const st = e.target.value;
                  setForm({
                    ...form,
                    source_type: st,
                    source_path: st === 'live' ? '0' : '',
                  });
                }}
                className="w-full bg-sky-50 border border-sky-200 rounded px-3 py-2 text-slate-700"
              >
                <option value="live">Webcam (Live)</option>
                <option value="video">Video File</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-500 mb-1">
                {form.source_type === 'live' ? 'Device Index' : form.source_type === 'rtsp' ? 'RTSP URL' : 'Video Path'}
              </label>
              {form.source_type === 'video' ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.source_path}
                    onChange={(e) => setForm({ ...form, source_path: e.target.value })}
                    placeholder="uploads/demo.mp4"
                    className="flex-1 bg-sky-50 border border-sky-200 rounded px-3 py-2 text-slate-700"
                    required
                  />
                  <label className="flex items-center gap-1 bg-sky-100 hover:bg-sky-200 px-3 py-2 rounded cursor-pointer text-sm text-sky-700">
                    <Upload className="w-4 h-4" />
                    {uploading ? '...' : 'Upload'}
                    <input type="file" accept=".mp4,.avi,.mov" onChange={handleUpload} className="hidden" />
                  </label>
                </div>
              ) : (
                <input
                  type="text"
                  value={form.source_path}
                  onChange={(e) => setForm({ ...form, source_path: e.target.value })}
                  placeholder={form.source_type === 'live' ? '0' : 'rtsp://...'}
                  className="w-full bg-sky-50 border border-sky-200 rounded px-3 py-2 text-slate-700"
                  required
                />
              )}
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="submit"
              className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg transition-colors"
            >
              Next: Draw Zones <ChevronRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-4 py-2 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* --- STEP 2: Zone drawing on live stream --- */}
      {showForm && step === 2 && newCameraId && (
        <div className="bg-white border border-sky-200 rounded-lg p-4 mb-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <span className="flex items-center justify-center w-7 h-7 rounded-full bg-sky-500 text-white text-sm font-bold">2</span>
            <h3 className="font-semibold text-slate-700">Draw Safety Zones</h3>
            <span className="text-xs text-slate-400">Camera: {newCameraId}</span>
            <span className="text-xs text-slate-400 ml-auto">Step 2 of 2 (optional)</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Stream + canvas */}
            <div className="lg:col-span-2">
              <div className="flex items-center gap-3 mb-2">
                <select
                  value={zoneType}
                  onChange={(e) => setZoneType(e.target.value)}
                  className="bg-sky-50 border border-sky-200 rounded px-3 py-1.5 text-slate-700 text-sm"
                >
                  <option value="restricted">Restricted (Red)</option>
                  <option value="proximity">Proximity (Orange)</option>
                  <option value="safe">Safe (Green)</option>
                </select>
                <input
                  type="text"
                  placeholder="Optional Name"
                  value={zoneName}
                  onChange={(e) => setZoneName(e.target.value)}
                  className="bg-sky-50 border border-sky-200 rounded px-2 py-1 text-slate-700 text-sm outline-none"
                />
                <span className="text-xs text-slate-400">Click points on stream</span>
                
                {polygonPts.length > 0 && (
                  <div className="ml-auto flex gap-2">
                     <button onClick={handleCancelZone} className="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded">Clear Points</button>
                     <button 
                       onClick={handleSaveZone} 
                       disabled={polygonPts.length < 6}
                       className="text-xs px-2 py-1 bg-sky-500 hover:bg-sky-600 text-white disabled:opacity-50 disabled:cursor-not-allowed rounded"
                     >
                       Save Shape
                     </button>
                  </div>
                )}
              </div>
              <div className="relative bg-slate-100 rounded-lg overflow-hidden" style={{ aspectRatio: `${streamSize.w}/${streamSize.h}` }}>
                <img
                  ref={imgRef}
                  src={`${getStreamUrl(newCameraId)}?ctx=setup`}
                  alt="Camera stream"
                  className="w-full h-full object-contain absolute inset-0"
                  onLoad={(e) => {
                    const img = e.target;
                    if (img.naturalWidth && img.naturalHeight) {
                      setStreamSize({ w: img.naturalWidth, h: img.naturalHeight });
                    }
                  }}
                  onError={(e) => { 
                    setTimeout(() => {
                      e.target.src = `${getStreamUrl(newCameraId)}?ctx=setup&retry=${Date.now()}`;
                    }, 2000);
                  }}
                />
                <canvas
                  ref={canvasRef}
                  className="absolute inset-0 w-full h-full cursor-crosshair"
                  onClick={handleCanvasClick}
                  onMouseMove={handleMouseMove}
                  onMouseLeave={() => setMousePos(null)}
                />
              </div>
              <div className="mt-2 flex items-center gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 bg-red-500/50 border border-red-500 inline-block"></span> Restricted
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 bg-orange-500/50 border border-orange-500 inline-block"></span> Proximity
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 bg-green-500/50 border border-green-500 inline-block"></span> Safe
                </span>
              </div>
            </div>

            {/* Rules + zone list */}
            <div>
              <div className="bg-sky-50 border border-sky-200 rounded-lg p-3 mb-3">
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-2 text-slate-700">
                  <ShieldAlert className="w-4 h-4 text-sky-500" /> Zone Rules
                </h4>
                <p className="text-xs text-slate-400 mb-2">Applied to the next zone you draw</p>
                <label className="flex items-center gap-2 mb-2">
                  <input
                    type="checkbox"
                    checked={zoneRules.helmet_required}
                    onChange={(e) => setZoneRules({ ...zoneRules, helmet_required: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-sm text-slate-600">Helmet Required</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={zoneRules.vest_required}
                    onChange={(e) => setZoneRules({ ...zoneRules, vest_required: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-sm text-slate-600">Vest Required</span>
                </label>
              </div>

              <h4 className="text-sm font-semibold mb-2 text-slate-700">Drawn Zones ({pendingZones.length})</h4>
              {pendingZones.length === 0 ? (
                <p className="text-xs text-slate-400">No zones yet. Draw on the stream or skip this step.</p>
              ) : (
                <div className="space-y-2 max-h-52 overflow-y-auto">
                  {pendingZones.map((zone) => (
                    <div key={zone.zone_id} className="bg-white border border-sky-200 rounded-lg p-2 flex items-center justify-between shadow-sm">
                      <div>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          zone.zone_type === 'restricted' ? 'bg-red-100 text-red-600' :
                          zone.zone_type === 'proximity' ? 'bg-orange-100 text-orange-600' :
                          'bg-green-100 text-green-600'
                        }`}>
                          {zone.zone_type}
                        </span>
                        {zone.name && <span className="ml-2 text-sm text-slate-600 font-medium">{zone.name}</span>}
                        <div className="flex gap-2 mt-1 text-xs text-slate-400">
                          {zone.rules?.helmet_required && <span>🪖 Helmet</span>}
                          {zone.rules?.vest_required && <span>🦺 Vest</span>}
                          {!zone.rules?.helmet_required && !zone.rules?.vest_required && <span>No PPE rules</span>}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeletePendingZone(zone.zone_id)}
                        className="text-red-400 hover:text-red-600 p-1"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              onClick={handleFinish}
              className="flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg transition-colors"
            >
              <Check className="w-4 h-4" /> Finish Setup
            </button>
            <button
              onClick={async () => {
                if (confirm('Cancel and delete this newly added camera?')) {
                  try {
                    await deleteCamera(newCameraId);
                  } catch (err) {
                    console.error('Cancel cleanup error:', err);
                  }
                  resetForm();
                  loadCameras();
                }
              }}
              className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-4 py-2 rounded-lg transition-colors ml-auto"
            >
              Cancel Setup
            </button>
          </div>
        </div>
      )}

      {/* Camera grid */}
      {cameras.length === 0 ? (
        <p className="text-slate-400">No cameras yet. Click "Add Camera" to get started.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {cameras.map((cam) => {
            const Icon = sourceIcons[cam.source_type] || Camera;
            return (
              <div key={cam.camera_id} className="bg-white border border-sky-200 rounded-lg overflow-hidden shadow-sm">
                <div className="aspect-video bg-slate-100 relative">
                  {cam.is_active && (
                    <img
                      src={`${getStreamUrl(cam.camera_id)}?ctx=grid`}
                      alt={cam.name}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        setTimeout(() => {
                          e.target.src = `${getStreamUrl(cam.camera_id)}?ctx=grid&retry=${Date.now()}`;
                        }, 2000);
                      }}
                    />
                  )}
                  {!cam.is_active && (
                    <div className="absolute inset-0 flex items-center justify-center text-slate-300">
                      <Camera className="w-12 h-12" />
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-medium text-slate-700">{cam.name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      (typeof cam.health === 'object' ? cam.health?.status : cam.health) === 'running'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-slate-100 text-slate-500'
                    }`}>
                      {typeof cam.health === 'object' ? cam.health?.status || 'unknown' : cam.health || 'unknown'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-400 mb-3">
                    <Icon className="w-3 h-3" />
                    <span>{cam.source_type} • {cam.source_path}</span>
                  </div>
                  <div className="flex gap-2 items-center flex-wrap">
                    <span className="text-xs bg-sky-50 border border-sky-200 text-sky-600 px-2 py-1 rounded">{cam.camera_id}</span>
                    <button
                      onClick={() => setCalibratingCamera(cam)}
                      className="bg-sky-500 hover:bg-sky-600 text-white text-xs px-2 py-1 rounded transition-colors"
                      title="Calibrate 3D Space"
                    >
                      Calibrate 3D
                    </button>
                    {cameraStatus[cam.camera_id]?.paused ? (
                      <button
                        onClick={() => handleResume(cam.camera_id)}
                        className="bg-green-500 hover:bg-green-600 text-white text-xs px-3 py-1 rounded transition-colors"
                        title="Resume detection"
                      >
                        Resume
                      </button>
                    ) : (
                      <button
                        onClick={() => handlePause(cam.camera_id)}
                        className="bg-yellow-500 hover:bg-yellow-600 text-white text-xs px-3 py-1 rounded transition-colors"
                        title="Pause detection"
                      >
                        Pause
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(cam.camera_id)}
                      className="ml-auto text-red-400 hover:text-red-600 p-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-400 border-t border-sky-100 pt-2">
                    <span>State: <span className="text-slate-600">{cameraStatus[cam.camera_id]?.paused ? 'Paused' : 'Running'}</span></span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {calibratingCamera && (
        <CalibrationModal
          camera={calibratingCamera}
          onClose={() => setCalibratingCamera(null)}
          onSuccess={() => {
            setCalibratingCamera(null);
            loadCameras();
          }}
        />
      )}
    </div>
  );
}
