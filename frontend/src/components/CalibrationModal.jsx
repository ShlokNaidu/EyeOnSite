import React, { useState, useRef, useEffect } from 'react';
import { getStreamUrl, calibrateCamera } from '../services/api';
import { X, Maximize } from 'lucide-react';

export default function CalibrationModal({ camera, onClose, onSuccess }) {
  const [points, setPoints] = useState([]);
  const [streamSize, setStreamSize] = useState({ w: 640, h: 480 });
  const [mousePos, setMousePos] = useState(null);
  const [realWidth, setRealWidth] = useState('5');
  const [realHeight, setRealHeight] = useState('10');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const canvasRef = useRef(null);
  const imgRef = useRef(null);

  function getCanvasCoords(e) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = streamSize.w / rect.width;
    const scaleY = streamSize.h / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    };
  }

  function handleCanvasClick(e) {
    if (points.length >= 4) return;
    const coords = getCanvasCoords(e);
    if (coords) {
      setPoints([...points, coords]);
    }
  }

  function handleMouseMove(e) {
    const coords = getCanvasCoords(e);
    if (coords) setMousePos(coords);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = streamSize.w;
    canvas.height = streamSize.h;
    ctx.clearRect(0, 0, streamSize.w, streamSize.h);

    if (points.length > 0) {
      ctx.strokeStyle = '#0ea5e9';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      
      if (points.length < 4 && mousePos) {
        ctx.lineTo(mousePos.x, mousePos.y);
      } else if (points.length === 4) {
        ctx.closePath();
      }
      ctx.stroke();

      ctx.fillStyle = '#0ea5e9';
      points.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = '14px sans-serif';
        ctx.fillText(i + 1, p.x + 8, p.y - 8);
        ctx.fillStyle = '#0ea5e9';
      });
    }
  }, [points, mousePos, streamSize]);

  async function handleCalibrate() {
    if (points.length !== 4) return;
    setLoading(true);
    setError('');
    
    const w = parseFloat(realWidth);
    const h = parseFloat(realHeight);
    
    if (isNaN(w) || isNaN(h) || w <= 0 || h <= 0) {
      setError('Please enter valid dimensions > 0');
      setLoading(false);
      return;
    }

    const source_points = points.map(p => [p.x, p.y]);
    const dest_points = [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h]
    ];

    try {
      await calibrateCamera(camera.camera_id, { source_points, dest_points });
      onSuccess();
    } catch (err) {
      setError(err.message || 'Calibration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex flex-col p-4 md:p-8">
      <div className="bg-white border border-sky-200 rounded-xl w-full h-full flex flex-col overflow-hidden max-w-6xl mx-auto shadow-2xl">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-sky-200">
          <h2 className="text-lg font-bold flex items-center gap-2 text-slate-800">
            <Maximize className="w-5 h-5 text-sky-500" />
            3D Ground Plane Calibration — {camera.name}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          
          {/* Left: Stream */}
          <div className="flex-1 bg-slate-100 relative flex items-center justify-center p-2">
            <div className="relative w-full shadow-lg overflow-hidden rounded-lg border border-sky-200" style={{ aspectRatio: `${streamSize.w}/${streamSize.h}`, maxHeight: '100%' }}>
              <img
                ref={imgRef}
                src={`${getStreamUrl(camera.camera_id)}?ctx=calibrate`}
                alt="Camera setup"
                className="w-full h-full object-contain absolute inset-0"
                onLoad={(e) => {
                  const img = e.target;
                  if (img.naturalWidth) setStreamSize({ w: img.naturalWidth, h: img.naturalHeight });
                }}
              />
              <canvas
                ref={canvasRef}
                className={`absolute inset-0 w-full h-full ${points.length < 4 ? 'cursor-crosshair' : 'cursor-default'}`}
                onClick={handleCanvasClick}
                onMouseMove={handleMouseMove}
                onMouseLeave={() => setMousePos(null)}
              />
            </div>
            {points.length < 4 && (
              <div className="absolute top-4 left-4 bg-sky-500 text-white px-3 py-1.5 rounded-lg animate-pulse pointer-events-none shadow-md">
                Click point {points.length + 1} of 4
              </div>
            )}
          </div>

          {/* Right: Sidebar */}
          <div className="w-full md:w-80 border-l border-sky-200 bg-sky-50/50 p-4 overflow-y-auto">
            <h3 className="font-semibold mb-4 text-sky-600">Instructions</h3>
            
            <ol className="text-sm text-slate-600 space-y-3 mb-6 list-decimal list-inside">
              <li>Click <strong>4 points</strong> on the ground in the video to outline a rectangular area.</li>
              <li>Order matters! Click: Top-Left, Top-Right, Bottom-Right, Bottom-Left.</li>
              <li>Enter the real-world width and height of this rectangle in meters.</li>
            </ol>

            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Real Width (meters)</label>
                <input 
                  type="number" step="0.1" 
                  value={realWidth} onChange={e => setRealWidth(e.target.value)}
                  className="w-full bg-white border border-sky-200 rounded-lg px-3 py-2 text-slate-700 focus:ring-2 focus:ring-sky-400 focus:border-transparent outline-none" 
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Real Height (meters)</label>
                <input 
                  type="number" step="0.1" 
                  value={realHeight} onChange={e => setRealHeight(e.target.value)}
                  className="w-full bg-white border border-sky-200 rounded-lg px-3 py-2 text-slate-700 focus:ring-2 focus:ring-sky-400 focus:border-transparent outline-none" 
                />
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 text-sm p-3 rounded-lg mb-4">
                {error}
              </div>
            )}

            <div className="space-y-3">
              <button 
                onClick={() => setPoints([])} 
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-600 py-2 rounded-lg transition-colors border border-slate-200"
                disabled={points.length === 0}
              >
                Clear Points
              </button>
              
              <button 
                onClick={handleCalibrate} 
                disabled={points.length !== 4 || loading}
                className="w-full bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white py-2 rounded-lg font-semibold transition-colors flex items-center justify-center shadow-md"
              >
                {loading ? 'Calibrating...' : 'Apply Calibration'}
              </button>
            </div>
            
          </div>
        </div>
      </div>
    </div>
  );
}
