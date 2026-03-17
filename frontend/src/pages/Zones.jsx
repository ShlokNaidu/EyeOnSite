import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getCameras, getZones, createZone, deleteZone, getStreamUrl } from '../services/api';
import { ShieldAlert, Trash2, Plus } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

const ZONE_COLORS = {
  restricted: { fill: 'rgba(239,68,68,0.25)', stroke: '#ef4444' },
  proximity: { fill: 'rgba(249,115,22,0.25)', stroke: '#f97316' },
  safe: { fill: 'rgba(34,197,94,0.25)', stroke: '#22c55e' },
};

export default function Zones() {
  const [cameras, setCameras] = useState([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [zones, setZones] = useState([]);
  const [polygonPts, setPolygonPts] = useState([]);
  const [mousePos, setMousePos] = useState(null);
  const [zoneType, setZoneType] = useState('restricted');
  const [zoneName, setZoneName] = useState('');
  const [rules, setRules] = useState({ helmet_required: true, vest_required: true });
  const [error, setError] = useState('');
  const [streamSize, setStreamSize] = useState({ w: 640, h: 480 });
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const imgRef = useRef(null);

  useEffect(() => {
    loadCameras();
  }, []);

  useEffect(() => {
    if (selectedCamera) loadZones(selectedCamera);
  }, [selectedCamera]);

  async function loadCameras() {
    try {
      const res = await getCameras();
      const cams = res.data || [];
      setCameras(cams);
      if (cams.length > 0 && !selectedCamera) {
        setSelectedCamera(cams[0].camera_id);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function loadZones(camera_id) {
    try {
      const res = await getZones(camera_id);
      setZones(res.data?.zones || []);
    } catch (err) {
      console.error(err);
    }
  }

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
    if (!selectedCamera) return;
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
    if (!selectedCamera) return;
    setMousePos(getCanvasCoords(e));
  }

  async function handleSaveZone() {
    if (polygonPts.length < 6) return;
    try {
      await createZone({
        camera_id: selectedCamera,
        name: zoneName,
        zone_type: zoneType,
        coordinates: polygonPts,
        rules,
      });
      setPolygonPts([]);
      setZoneName('');
      await loadZones(selectedCamera);
    } catch (err) {
      setError(err.message);
    }
  }

  function handleCancelZone() {
    setPolygonPts([]);
  }

  async function handleDeleteZone(zone_id) {
    try {
      await deleteZone(zone_id);
      await loadZones(selectedCamera);
    } catch (err) {
      setError(err.message);
    }
  }

  // Draw zones on canvas overlay
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = streamSize.w;
    canvas.height = streamSize.h;
    ctx.clearRect(0, 0, streamSize.w, streamSize.h);

    // Draw existing zones
    zones.forEach((zone) => {
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
        // Fallback for rects
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
  }, [zones, polygonPts, mousePos, zoneType, streamSize]);

  const { t } = useLanguage();

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6 text-slate-800">{t('zones')}</h1>

      {error && (
        <div className="bg-red-50 border border-red-300 text-red-600 p-3 rounded-lg mb-4">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Stream + Canvas */}
        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center gap-4">
            <select
              value={selectedCamera}
              onChange={(e) => setSelectedCamera(e.target.value)}
              className="bg-white border border-sky-200 rounded px-3 py-2 text-slate-700"
            >
              {cameras.map((c) => (
                <option key={c.camera_id} value={c.camera_id}>
                  {c.name} ({c.camera_id})
                </option>
              ))}
            </select>
            <select
              value={zoneType}
              onChange={(e) => setZoneType(e.target.value)}
              className="bg-white border border-sky-200 rounded px-3 py-2 text-slate-700"
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
              className="bg-white border border-sky-200 rounded px-3 py-2 text-slate-700 outline-none"
            />
          </div>

          <div ref={containerRef} className="relative bg-slate-100 rounded-lg overflow-hidden" style={{ aspectRatio: `${streamSize.w}/${streamSize.h}` }}>
            {selectedCamera && (
              <img
                ref={imgRef}
                src={`${getStreamUrl(selectedCamera)}?ctx=zones`}
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
                      e.target.src = `${getStreamUrl(selectedCamera)}?ctx=zones&retry=${Date.now()}`;
                    }, 2000);
                  }}
              />
            )}
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
            <span className="ml-auto">Click points on stream to draw polygon shape</span>
            
            {polygonPts.length > 0 && (
              <div className="flex gap-2">
                 <button onClick={handleCancelZone} className="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded">Clear</button>
                 <button 
                   onClick={handleSaveZone} 
                   disabled={polygonPts.length < 6}
                   className="text-xs px-2 py-1 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 disabled:cursor-not-allowed rounded text-white"
                 >
                   Save Shape
                 </button>
              </div>
            )}
          </div>
        </div>

        {/* Zone list + rules */}
        <div>
          <div className="bg-white border border-sky-200 rounded-lg p-4 mb-4 shadow-sm">
            <h3 className="font-semibold mb-3 text-slate-700">Zone Rules</h3>
            <label className="flex items-center gap-2 mb-2">
              <input
                type="checkbox"
                checked={rules.helmet_required}
                onChange={(e) => setRules({ ...rules, helmet_required: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm text-slate-600">Helmet Required</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={rules.vest_required}
                onChange={(e) => setRules({ ...rules, vest_required: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm text-slate-600">Vest Required</span>
            </label>
          </div>

          <h3 className="font-semibold mb-2 text-slate-700">Existing Zones</h3>
          {zones.length === 0 ? (
            <p className="text-sm text-slate-400">No zones. Draw one on the stream.</p>
          ) : (
            <div className="space-y-2">
              {zones.map((zone) => (
                <div key={zone.zone_id} className="bg-white border border-sky-200 rounded-lg p-3 flex items-center justify-between shadow-sm">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        zone.zone_type === 'restricted' ? 'bg-red-100 text-red-600' :
                        zone.zone_type === 'proximity' ? 'bg-orange-100 text-orange-600' :
                        'bg-green-100 text-green-600'
                      }`}>
                        {zone.zone_type}
                      </span>
                      {zone.name && <span className="text-sm font-medium text-slate-600">{zone.name}</span>}
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      [{zone.coordinates.join(', ')}]
                    </p>
                  </div>
                  <button
                    onClick={() => handleDeleteZone(zone.zone_id)}
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
    </div>
  );
}
