

# --- New Pause/Status Endpoints ---
# (must be after app = FastAPI(...))


"""
FastAPI application for the AI Service.
Handles camera registration, zone updates, streaming, and health checks.
"""

import os
import sys
from dotenv import load_dotenv

# Load env from project root
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

from camera_thread import CameraThread, STATE_STOPPED
from streaming import create_stream_response
from zones import zone_manager

app = FastAPI(title="Construction Safety AI Service", version="2.1")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve snapshots
SNAPSHOTS_DIR = os.path.join(os.path.dirname(__file__), "snapshots")
os.makedirs(SNAPSHOTS_DIR, exist_ok=True)
app.mount("/snapshots", StaticFiles(directory=SNAPSHOTS_DIR), name="snapshots")

# Demo videos directory
DEMO_DIR = os.path.join(os.path.dirname(__file__), "demo_videos")
os.makedirs(DEMO_DIR, exist_ok=True)

# Global camera thread registry
camera_threads: Dict[str, CameraThread] = {}


# --- Request models ---

class PauseCameraRequest(BaseModel):
    camera_id: str

class RegisterCameraRequest(BaseModel):
    camera_id: str
    source_type: str  # live, rtsp, video
    source_path: str
    paused: bool = False  # When True, stream only — no detection until activated
    homography_matrix: Optional[List[List[float]]] = None


class ActivateCameraRequest(BaseModel):
    camera_id: str


class CalibrateCameraRequest(BaseModel):
    camera_id: str
    source_points: List[List[float]]  # 4 pixel points [[x,y],...]
    dest_points: List[List[float]]    # 4 real-world meter points [[x,y],...]


class UpdateZoneRequest(BaseModel):
    camera_id: str
    zone_id: Optional[str] = None
    zone_type: Optional[str] = None
    coordinates: Optional[List[float]] = None
    rules: Optional[Dict[str, Any]] = None
    zones: Optional[List[Dict[str, Any]]] = None


class StopCameraRequest(BaseModel):
    camera_id: str


# --- Routes ---

@app.post("/register_camera")
async def register_camera(req: RegisterCameraRequest):
    """Register and start a new camera thread."""
    if req.camera_id in camera_threads:
        existing = camera_threads[req.camera_id]
        if existing.is_alive() and existing.state != STATE_STOPPED:
            return {"status": "already_running"}
        # Clean up dead thread
        del camera_threads[req.camera_id]

    # Resolve source path for video files
    source = req.source_path
    if req.source_type == "video":
        # Check various locations
        candidates = [
            source,
            os.path.join(os.path.dirname(__file__), "..", "server", source),
            os.path.join(os.path.dirname(__file__), source),
            os.path.join(DEMO_DIR, os.path.basename(source)),
        ]
        resolved = None
        for c in candidates:
            if os.path.exists(c):
                resolved = os.path.abspath(c)
                break
        if resolved:
            source = resolved
        else:
            print(f"[AI] Warning: video source not found at any candidate path: {candidates}")

    thread = CameraThread(
        camera_id=req.camera_id,
        source=source,
        source_type=req.source_type,
        paused=req.paused,
    )
    if req.homography_matrix is not None:
        thread.homography_matrix = req.homography_matrix
    camera_threads[req.camera_id] = thread
    thread.start()

    return {"status": "started", "paused": req.paused}


@app.post("/activate_camera")
async def activate_camera(req: ActivateCameraRequest):
    """Unpause a camera thread to start detection."""
    thread = camera_threads.get(req.camera_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Camera not found")
    thread.paused = False
    thread._reset_video = True  # Reset video to start so detection begins from frame 1
    print(f"[{req.camera_id}] Camera activated — detection started")
    return {"status": "activated"}


@app.post("/calibrate_camera")
async def calibrate_camera(req: CalibrateCameraRequest):
    """Compute and update the Homography Matrix for a camera."""
    import cv2
    import numpy as np
    
    thread = camera_threads.get(req.camera_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Camera not running")
        
    if len(req.source_points) != 4 or len(req.dest_points) != 4:
        raise HTTPException(status_code=400, detail="Must provide exactly 4 source and 4 destination points")
        
    src_pts = np.array(req.source_points, dtype=np.float32)
    dst_pts = np.array(req.dest_points, dtype=np.float32)
    
    H, status = cv2.findHomography(src_pts, dst_pts)
    if H is not None:
        thread.homography_matrix = H.tolist()
        print(f"[{req.camera_id}] Camera calibrated. 3D Homography Matrix applied.")
        return {"status": "calibrated", "homography_matrix": thread.homography_matrix}
    else:
        raise HTTPException(status_code=400, detail="Failed to compute homography matrix")


@app.post("/update_zone")
async def update_zone(req: UpdateZoneRequest):
    """Update zone configuration for a camera."""
    if req.zones is not None:
        # Bulk zone replace — set all zones at once (handles deletions)
        zone_manager.set_zones(req.camera_id, req.zones)
    elif req.zone_id and req.coordinates:
        zone_manager.update_zone(req.camera_id, {
            "zone_id": req.zone_id,
            "zone_type": req.zone_type or "restricted",
            "coordinates": req.coordinates,
            "rules": req.rules or {"helmet_required": True, "vest_required": True},
        })
    return {"status": "updated"}


@app.post("/stop_camera")
async def stop_camera(req: StopCameraRequest):
    """Stop a camera thread."""
    thread = camera_threads.get(req.camera_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Camera not found")

    thread.stop()
    thread.join(timeout=5)
    zone_manager.remove_camera(req.camera_id)
    del camera_threads[req.camera_id]

    return {"status": "stopped"}


@app.get("/stream/{camera_id}")
async def stream(camera_id: str):
    """MJPEG video stream for a camera."""
    thread = camera_threads.get(camera_id)
    if not thread or not thread.is_alive():
        raise HTTPException(status_code=404, detail="Camera not running")
    return create_stream_response(thread)


@app.get("/health")
async def health():
    """AI service health check."""
    from detection import _using_world_model
    return {
        "status": "healthy",
        "active_cameras": len([t for t in camera_threads.values() if t.is_alive()]),
        "is_fallback": _using_world_model
    }


@app.get("/health/cameras")
async def camera_health():
    """Per-camera health status."""
    result = {}
    for cam_id, thread in camera_threads.items():
        result[cam_id] = {
            "status": thread.state,
            "fps": round(thread.fps, 1),
            "frame_count": thread.frame_count,
            "alive": thread.is_alive(),
        }
    return result
@app.post("/pause_camera")
async def pause_camera(req: PauseCameraRequest):
    """Pause a camera thread (stop detection, keep streaming)."""
    thread = camera_threads.get(req.camera_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Camera not found")
    thread.paused = True
    print(f"[{req.camera_id}] Camera paused — detection stopped")
    return {"status": "paused"}

@app.get("/camera_status/{camera_id}")
async def camera_status(camera_id: str):
    """Get current status (running/paused/stopped) for a camera."""
    thread = camera_threads.get(camera_id)
    if not thread:
        return {"status": "not_found"}
    return {
        "status": thread.state,
        "paused": getattr(thread, "paused", False),
        "alive": thread.is_alive(),
    }

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PYTHON_PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
