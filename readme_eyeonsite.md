# EyeOnSite — AI/ML Service: Complete Technical Deep-Dive

> **Version:** 2.1  
> **Runtime:** Python 3.10+ / FastAPI / Uvicorn  
> **Inference Engine:** Ultralytics YOLOv8 + ByteTrack  
> **Hardware Target:** Edge devices (Jetson Nano/Orin, consumer GPU, CPU-only fallback)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Module Map & Data Flow](#2-module-map--data-flow)
3. [Module 1 — `detection.py` (The Retina)](#3-module-1--detectionpy-the-retina)
4. [Module 2 — `tracker.py` (The Hippocampus)](#4-module-2--trackerpy-the-hippocampus)
5. [Module 3 — `spatial_logic.py` (The Parietal Lobe)](#5-module-3--spatial_logicpy-the-parietal-lobe)
6. [Module 4 — `camera_thread.py` (The Reflex System)](#6-module-4--camera_threadpy-the-reflex-system)
7. [Module 5 — `main.py` (The Spinal Cord)](#7-module-5--mainpy-the-spinal-cord)
8. [Module 6 — `streaming.py` (The Optic Nerve)](#8-module-6--streamingpy-the-optic-nerve)
9. [Module 7 — `zones.py` (The Memory Map)](#9-module-7--zonespy-the-memory-map)
10. [Advanced Feature 1 — Edge-Based Idle State Detection (Logistic Regression)](#10-advanced-feature-1--edge-based-idle-state-detection)
11. [Advanced Feature 2 — ConfMOT: Confidence-Based Adaptive Kalman Filter](#11-advanced-feature-2--confmot-confidence-based-adaptive-kalman-filter)
12. [Advanced Feature 3 — Homography-Based Vehicle Speed Measurement](#12-advanced-feature-3--homography-based-vehicle-speed-measurement)
13. [Advanced Feature 4 — Posture-Dependent Safety Ellipses](#13-advanced-feature-4--posture-dependent-safety-ellipses)
14. [Smart Alert Dispatch System](#14-smart-alert-dispatch-system)
15. [Environment Variable Reference](#15-environment-variable-reference)
16. [Frontend Integration — How It All Shows Up](#16-frontend-integration--how-it-all-shows-up)

---

## 1. Architecture Overview

EyeOnSite's AI service is a **multi-threaded, real-time computer vision pipeline** that processes live or recorded video feeds from construction site cameras. It is designed as a standalone Python microservice that communicates with a Node.js/Express backend via REST API and serves annotated MJPEG video streams directly to the React frontend.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CAMERA SOURCES                              │
│   (Webcam / RTSP IP Camera / Demo .mp4 Video File)                 │
└───────────────┬─────────────────────────────────────────────────────┘
                │  cv2.VideoCapture()
                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     CAMERA THREAD (Per Camera)                      │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐  ┌───────────┐ │
│  │ Frame    │→ │ YOLO v8      │→ │ Categorize    │→ │ Spatial   │ │
│  │ Capture  │  │ + ByteTrack  │  │ Detections    │  │ Logic     │ │
│  └──────────┘  └──────────────┘  └───────────────┘  └───────────┘ │
│       │                                                     │       │
│       │         ┌───────────────┐  ┌───────────────┐        │       │
│       │         │ Worker        │  │ Machine       │        │       │
│       │         │ Tracker       │  │ Tracker       │        │       │
│       │         │ (ConfMOT KF)  │  │ (MAD + LR)    │        │       │
│       │         └───────────────┘  └───────────────┘        │       │
│       │                                                     │       │
│       ▼                                                     ▼       │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────────────┐ │
│  │ Annotate │← │ Safety       │← │ Violations + Predictive       │ │
│  │ Frame    │  │ Ellipses     │  │ Collision Warnings             │ │
│  └────┬─────┘  └──────────────┘  └───────────────────────────────┘ │
│       │                                                             │
│       ├──→ MJPEG Stream (to React frontend via /stream/{id})       │
│       └──→ Alert Dispatch (POST to Express /api/alerts)             │
└─────────────────────────────────────────────────────────────────────┘
```

**Key Design Principles:**
- **Thread-per-camera isolation:** Each camera runs in its own Python thread with its own tracker state. A crash in one camera never affects others.
- **Thread-safe inference:** A global `threading.Lock()` wraps all YOLO calls to prevent GPU memory corruption from concurrent model access.
- **Zero external ML dependencies:** All advanced tracking features (Kalman Filter, Logistic Regression, MAD) are implemented using pure Python `math` and `sorted()`. No scikit-learn, no TensorFlow, no PyTorch beyond Ultralytics.
- **Edge-first philosophy:** Every algorithmic decision prioritises computational cheapness. Heavy appearance-based re-identification networks (DeepSORT, BoT-SORT) are deliberately avoided.

---

## 2. Module Map & Data Flow

| File | Role | Analogy |
|---|---|---|
| `detection.py` | YOLO model loading, inference, PPE inference | **The Retina** — raw visual perception |
| `tracker.py` | Position memory, velocity estimation, idle detection, speed | **The Hippocampus** — memory & motion math |
| `spatial_logic.py` | Distance calculation, zone collision, violation checks | **The Parietal Lobe** — spatial awareness |
| `camera_thread.py` | Main processing loop, annotation, alert dispatch | **The Reflex System** — decision & action |
| `main.py` | FastAPI REST API, camera lifecycle management | **The Spinal Cord** — command & control |
| `streaming.py` | MJPEG frame broadcasting | **The Optic Nerve** — visual output |
| `zones.py` | Zone configuration storage | **The Memory Map** — spatial memory |

**Per-frame data flow (simplified):**

```
Raw Frame
  │
  ├─→ run_tracking(frame)          → [{class, confidence, bbox, track_id}, ...]
  │
  ├─→ categorize_detections()      → persons[], helmets[], no_helmets[], vests[], no_vests[], machines[]
  │
  ├─→ update_machine_position()    → machine_history[key] = [(cx,cy,area,wx,wy,t), ...]
  ├─→ is_machine_moving()          → True/False (MAD + Logistic Regression)
  ├─→ get_machine_speed()          → float km/h (Homography projection)
  │
  ├─→ update_position(confidence)  → kf_states[id] = {x,y,vx,vy} (Adaptive Kalman)
  ├─→ check_violations()           → [{type, metadata}, ...]
  ├─→ check_no_movement()          → alert_type or None
  ├─→ check_predictive_collisions()→ [{type, metadata}, ...]
  │
  ├─→ _annotate_frame()            → OpenCV-drawn annotated frame with:
  │     ├─ Zone overlays (20% opacity polygons)
  │     ├─ Machine bboxes + speed labels
  │     ├─ Posture-dependent safety ellipses (30% opacity)
  │     ├─ Body cube wireframes
  │     ├─ Worker tags (colour-coded pills)
  │     ├─ Predictive dashed bboxes
  │     ├─ PPE violation labels
  │     └─ Status legend
  │
  ├─→ _fire_alert()                → POST to Express backend with snapshot
  └─→ cv2.imencode()               → Stored as latest_frame_jpeg for MJPEG broadcast
```

---

## 3. Module 1 — `detection.py` (The Retina)

### 3.1 Model Loading Strategy (Cascade Fallback)

The system uses a **three-tier model cascade** to guarantee functionality across all deployment scenarios:

```
Priority 1: custom_safety_best.pt  (Custom-trained, 10 classes)
    ↓ (not found)
Priority 2: yolov8s-worldv2.pt    (Zero-shot open-vocabulary)
    ↓ (not found)
Priority 3: yolov8s.pt            (COCO baseline, person-only)
```

| Tier | Model | Classes | PPE Detection | Machinery Detection |
|---|---|---|---|---|
| 1 | Custom `.pt` | 10 explicit (`helmet`, `no_helmet`, `vest`, `no_vest`, `person`, `machinery`, etc.) | ✅ Direct | ✅ Direct |
| 2 | YOLOv8s-World | Open-vocabulary (`person`, `hard hat`, `safety vest`, `excavator`, `crane`, `bulldozer`, `truck`) | ⚠️ Inferred (missing PPE = no detection overlap) | ✅ Mapped to `machinery` |
| 3 | YOLOv8s COCO | 80 COCO classes | ❌ Disabled | ❌ Disabled |

### 3.2 The Custom Model Class Map

```python
CUSTOM_CLASS_NAMES = {
    0: "helmet",       # Hardhat detected
    1: "mask",         # Face mask
    2: "no_helmet",    # Explicit missing-hardhat detection
    3: "no_mask",      # Missing mask
    4: "no_vest",      # Explicit missing-vest detection
    5: "person",       # Full body
    6: "safety_cone",  # Traffic cone
    7: "vest",         # Safety vest detected
    8: "machinery",    # Heavy equipment
    9: "machinery",    # Vehicle (mapped to machinery)
}
```

**Why "no_helmet" is a separate class (not inferred):**  
Most YOLO safety systems check whether a `helmet` bounding box overlaps a `person` bounding box — if it doesn't, they assume the helmet is missing. This causes **massive false positives** in cluttered Indian construction sites because helmets can be occluded by scaffolding, pipes, or other workers. Our custom model is explicitly trained to recognise the visual pattern of a head *without* a helmet. This is called **dual-labelling** and drastically reduces false positives.

### 3.3 Per-Class Confidence Thresholds

```python
PERSON_CONF    = 0.40   # Liberal — detect far-away workers
HELMET_CONF    = 0.35   # Moderate
NO_HELMET_CONF = 0.35   # Moderate
VEST_CONF      = 0.35   # Moderate
NO_VEST_CONF   = 0.35   # Moderate
MACHINERY_CONF = 0.45   # Strict — avoid false positives on debris
NMS_IOU        = 0.55   # Non-Maximum Suppression overlap threshold
```

YOLO runs inference at `conf=0.25` (very low bar), then per-class thresholds are applied in post-processing. This gives us granular control without re-running inference.

### 3.4 PPE Association Logic

When the **World model** is used (no explicit `no_helmet` class), the system must *infer* missing PPE:

1. **Helmet check:** For each person, check if any helmet bbox is:
   - Geometrically near the head area (`_helmet_near_head` — center within upper 35% of person box)
   - Vertically contained within the person (`_contains_vertically`)
   - Has sufficient IoU overlap (`_iou > 0.30`)

2. **Vest check:** For each person:
   - First: Check if any YOLO vest detection overlaps the torso
   - **Fallback:** If no YOLO vest found, run `_has_hivis_color()` — a colour-based HSV analysis that scans the torso region for hi-vis yellow (H:20–85, S:80–255, V:120–255) or orange pixels (H:0–20, S:100–255, V:120–255). If ≥5% of the torso is hi-vis, vest is assumed present.

3. **Small person filter:** Persons shorter than `MIN_PERSON_HEIGHT_PX = 30` pixels are skipped entirely — PPE detection on tiny boxes is unreliable and generates noise.

### 3.5 Tracking via ByteTrack

```python
results = model.track(
    frame,
    tracker="bytetrack.yaml",
    persist=True,          # Maintain IDs across frames
)
```

ByteTrack is a lightweight multi-object tracker that uses only bounding box IoU for association (no appearance features). It assigns persistent `track_id` integers to each detected object across frames. The `persist=True` flag ensures the tracker's internal state survives between calls.

---

## 4. Module 2 — `tracker.py` (The Hippocampus)

This is the mathematical brain of the system. It maintains rolling position histories for every tracked object and performs all kinematic computations.

### 4.1 Data Structures

```python
class WorkerTracker:
    position_history = {}      # { track_id: [(cx, cy), ...] }
    last_predictive_alert = {} # { track_id: { alert_type: frame_num } }
    machine_history = {}       # { machine_key: [(cx, cy, area, wx, wy, t), ...] }
    stationary_since = {}      # { track_id: timestamp }
    last_center = {}           # { track_id: (cx, cy) }
    kf_states = {}             # { track_id: {"x", "y", "vx", "vy"} }
```

### 4.2 Adaptive Kalman Filter (ConfMOT)

Every call to `update_position(track_id, bbox, confidence)` runs a full Kalman Filter cycle:

**Step 1 — Predict:**
```
pred_x = state.x + state.vx
pred_y = state.y + state.vy
```
This uses a constant-velocity kinematic model. It assumes the worker will continue moving in the same direction at the same speed.

**Step 2 — Update (Adaptive Gain):**
```
K = clamp(confidence, 0.0, 1.0)

trusted_x = pred_x + K × (measured_x - pred_x)
trusted_y = pred_y + K × (measured_y - pred_y)
```

The Kalman Gain `K` is directly mapped to YOLO's confidence score:
- **conf = 0.95 → K = 0.95:** The system heavily trusts the measurement. The tracked position snaps to where YOLO says the person is.
- **conf = 0.30 → K = 0.30:** The system mostly ignores the noisy measurement and glides along its predicted trajectory. This prevents identity switches when workers overlap.

**Step 3 — Velocity Update:**
```
alpha = VELOCITY_ALPHA × K
state.vx = alpha × inst_vx + (1 - alpha) × state.vx
state.vy = alpha × inst_vy + (1 - alpha) × state.vy
```

The velocity EMA smoothing factor is *also* scaled by confidence. A low-confidence detection not only gets a dampened position update but also can't cause sudden velocity spikes (which would corrupt predictive collision forecasts).

**The output position stored in `position_history` is the *trusted/smoothed* coordinate, NOT the raw YOLO bounding box center.** This means all downstream computations (predictive collisions, proximity checks, speed calculations) operate on clean data.

### 4.3 Velocity Estimation — O(1)

```python
def estimate_velocity(self, track_id):
    if track_id in self.kf_states:
        return state["vx"], state["vy"]
    return 0.0, 0.0
```

Because the Kalman Filter continuously maintains velocity as part of its state, velocity retrieval is a simple dictionary lookup — **O(1) constant time**. The old EMA approach required iterating over the entire history window — O(n) per call.

### 4.4 Predictive Collision Detection

```python
def predict_future_bbox(self, track_id, current_bbox, t=T_HORIZON):
    vx, vy = self.estimate_velocity(track_id)
    return [x1 + vx*t, y1 + vy*t, x2 + vx*t, y2 + vy*t]
```

The system projects each worker's bounding box forward by `T_HORIZON` frames (default: 2) using their smoothed velocity. It then checks:

1. **Zone entry prediction:** Will the worker's future foot-point land inside a restricted/proximity zone?
2. **Machinery collision prediction:** Will the worker's future position be within 2 meters of a machine?

**Safety filters to prevent false positives:**
- Worker must be moving faster than `MIN_VELOCITY_PX = 3.0 px/frame` (ignores stationary workers)
- Worker must currently be *outside* the danger zone (only predicts *entry*, not re-alerts inside)
- Worker must be within `MAX_PREDICT_DISTANCE = 200 px` of the zone (distant predictions are unreliable)
- A cooldown of `PREDICTIVE_COOLDOWN_FRAMES = 15` frames prevents alert spam

### 4.5 No-Movement / Fall Detection

The system differentiates between two types of stillness:

| Posture | Detection Method | Alert Threshold | Alert Type |
|---|---|---|---|
| **Fallen** | `bbox width / height > 1.3` | 60 seconds | `fall_no_movement` |
| **Upright/Sitting** | Aspect ratio ≤ 1.3 | 300 seconds (5 min) | `no_movement` |

A fallen worker who hasn't moved for 60 seconds triggers immediate concern (medical emergency). An upright worker who hasn't moved in 5 minutes may be idle/sleeping on the job.

Movement is measured as pixel displacement of the bounding box center. Anything below `STILL_THRESHOLD_PX = 8.0` pixels is considered stationary.

---

## 5. Module 3 — `spatial_logic.py` (The Parietal Lobe)

### 5.1 Coordinate Systems

The system supports **two simultaneous coordinate systems**:

| Mode | Indicator | Distance Unit | Accuracy |
|---|---|---|---|
| **2D Pixel** | "2D PX" label on frame | Centimetres (estimated) | ±30% (perspective distortion) |
| **3D Homography** | "3D CAL" label on frame | Meters (real-world) | ±5% (calibrated) |

### 5.2 Ground Position Extraction

```python
def get_ground_position(bbox, H=None):
    foot_cx = (x1 + x2) / 2.0    # Horizontal center of bbox
    foot_cy = float(y2)           # Bottom edge of bbox (feet/tires)
    
    if H is not None:
        # Project pixel to real-world via Homography
        pt = np.array([[[foot_cx, foot_cy]]], dtype=np.float32)
        real_pt = cv2.perspectiveTransform(pt, H)
        return real_pt[0][0][0], real_pt[0][0][1]  # meters
    
    return foot_cx, foot_cy  # pixels
```

The "foot-point" (bottom-center of the bounding box) is used because it represents where the person's feet or the machine's tires touch the ground. This is the most geometrically stable point for distance measurements because it lies on the ground plane that the Homography matrix maps.

### 5.3 Homography Matrix (3×3)

The Homography matrix `H` is a 3×3 perspective transformation matrix computed from 4 point correspondences:
- **Source:** 4 pixel coordinates clicked on the camera frame (e.g., corners of a known rectangle on the ground)
- **Destination:** 4 real-world metric coordinates of those same points

```python
H, status = cv2.findHomography(src_pts, dst_pts)
```

Once computed, any pixel coordinate on the ground plane can be transformed to real-world meters via:
```
[wx]       [h11 h12 h13]   [px]
[wy] = H × [h21 h22 h23] × [py]
[w ]       [h31 h32 h33]   [1 ]

real_x = wx / w
real_y = wy / w
```

### 5.4 Violation Check Pipeline

For each person in each frame, `check_violations()` runs these checks in order:

1. **PPE — Helmet:** Is there an explicit `no_helmet` detection overlapping this person's bbox?
2. **PPE — Vest:** Is there an explicit `no_vest` detection overlapping this person's bbox?
3. **Zone — Restricted:** Is the person's foot-point inside any restricted polygon?
4. **Zone — Proximity:** Is the person inside a proximity zone AND missing required PPE?
5. **Machinery — Proximity:** Is the person within 2 meters (or `MACHINE_MARGIN` pixels) of any *moving* machine?

**Critical detail:** Machinery proximity checks only fire against **moving machines** (filtered through the Logistic Regression idle detector). A parked excavator will never trigger a proximity alert.

---

## 6. Module 4 — `camera_thread.py` (The Reflex System)

### 6.1 Thread Lifecycle

```
STATE_INIT → STATE_STARTING → STATE_RUNNING ↔ STATE_DEGRADED → STATE_STOPPING → STATE_STOPPED
```

- **DEGRADED:** Entered when frame capture fails (e.g., RTSP camera offline). The system retries up to 20 times with 100ms delays.
- **For RTSP:** After max retries, the entire capture is released and re-opened (full reconnect).
- **For video files:** Failed reads reset to frame 0 (video loops forever for demos).

### 6.2 Frame Sampling

```python
FRAME_SKIP = 2  # Process every 2nd frame
```

At a 20 FPS capture rate, this gives ~10 FPS effective inference rate. This halves GPU load while maintaining sufficient temporal resolution for tracking.

### 6.3 Paused Mode

When `paused=True`, the camera still captures and broadcasts frames (so the frontend shows a live preview), but **all detection, tracking, and alerting is completely skipped**. This allows the frontend to show the camera feed during zone setup without burning GPU resources.

### 6.4 PPE Persistence Filter

To prevent flickering PPE violations (detected one frame, gone the next), the system requires a violation to be **continuously detected for 1.5 seconds** before confirming it:

```python
_PPE_CONFIRM_SECS = 1.5    # Must persist for 1.5s to confirm
_PPE_CLEAR_GRACE_SECS = 0.5 # Must be clear for 0.5s to dismiss
```

This eliminates single-frame false positives where a person briefly turns their head and YOLO momentarily loses the helmet detection.

### 6.5 Frame Annotation Pipeline

The annotation is drawn in a precise layering order to ensure correct visual depth:

```
Layer 1: Zone fills (20% opacity)
Layer 2: Zone outlines + labels
Layer 3: Machine bboxes + speed labels
Layer 4: Posture safety ellipses (30% opacity)
Layer 5: Body cube wireframes
Layer 6: Worker tags (filled pill labels)
Layer 7: Predictive dashed bboxes (cyan)
Layer 8: PPE violation indicators (red)
Layer 9: Status legend (top-right)
Layer 10: Calibration indicator ("3D CAL" or "2D PX")
```

### 6.6 Alert Dispatch

When a violation is confirmed, the system:
1. **Captures a snapshot** of the annotated frame as PNG (in a background thread to avoid blocking)
2. **Deduplicates:** Reuses the same snapshot if the same alert type fired within 30 seconds
3. **Sends HTTP POST** to the Express backend at `{EXPRESS_URL}/api/alerts` with:
   ```json
   {
     "camera_id": "CAM01",
     "type": "machinery_proximity",
     "timestamp": "2026-04-22T18:04:22.000Z",
     "snapshot_url": "/snapshots/CAM01_machinery_proximity_1745339062_a1b2c3d4.png",
     "metadata": {
       "worker_track_id": "track_5",
       "machine_class": "excavator",
       "distance_m": 1.42
     }
   }
   ```
4. **Retry queue:** If the Express backend is down, the alert is buffered in a `deque(maxlen=100)`. On subsequent frames, up to 5 buffered alerts are retried per frame.

---

## 7. Module 5 — `main.py` (The Spinal Cord)

FastAPI application with the following endpoints:

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/register_camera` | Start a new camera thread (live/RTSP/video) |
| `POST` | `/activate_camera` | Unpause a camera to begin detection |
| `POST` | `/pause_camera` | Pause detection (keep streaming) |
| `POST` | `/stop_camera` | Terminate a camera thread |
| `POST` | `/calibrate_camera` | Compute Homography from 4 point pairs |
| `POST` | `/update_zone` | Add/update/clear zones for a camera |
| `GET` | `/stream/{camera_id}` | MJPEG video stream |
| `GET` | `/health` | Service health + active camera count |
| `GET` | `/health/cameras` | Per-camera status, FPS, frame count |
| `GET` | `/camera_status/{id}` | Individual camera state |

**CORS:** Allows all origins (`*`) for development. Should be restricted in production.

**Static file serving:** Snapshots are served from `/snapshots/` directory.

---

## 8. Module 6 — `streaming.py` (The Optic Nerve)

Implements **MJPEG (Motion-JPEG) streaming** — a simple but effective protocol where each frame is a standalone JPEG image sent over an HTTP multipart boundary.

```python
media_type="multipart/x-mixed-replace; boundary=frame"
```

- **Framerate:** Capped at ~30 FPS streaming rate (`time.sleep(0.033)`)
- **Blank frame:** If no frame is available yet, a "Connecting..." placeholder is sent
- **Pre-encoded:** Frames are JPEG-compressed once in the camera thread, then broadcast as raw bytes. Multiple viewers share the same pre-encoded frame (zero re-encoding overhead).

---

## 9. Module 7 — `zones.py` (The Memory Map)

A simple in-memory zone configuration manager:
- Stores zone polygons per camera as `{ camera_id: [zone_configs] }`
- Supports polygon coordinates (`[x1,y1,x2,y2,x3,y3,...]`) and rectangle shortcuts (`[x1,y1,x2,y2]`)
- Zone types: `restricted` (no entry) and `proximity` (PPE-conditional entry)
- Thread-safe access via the `zone_manager` singleton

---

## 10. Advanced Feature 1 — Edge-Based Idle State Detection

### The Problem
YOLO draws bounding boxes around machines every frame. Even a perfectly still, parked excavator will have its bounding box "jitter" by 1–5 pixels per frame due to lighting changes, shadow movement, sensor noise, and YOLO's non-deterministic inference. A naive movement threshold (`displacement > 3px`) will falsely classify a parked machine as "moving."

### The Solution: MAD + Logistic Regression

**Step 1 — Feature Extraction (over ~1.5s / 15 frames):**
```python
for each consecutive frame pair (i-1, i):
    centroid_diff = sqrt((cx2-cx1)² + (cy2-cy1)²)    # px
    area_diff     = |area2 - area1|                    # px²
```

**Step 2 — Robust Statistics (MAD):**
```python
MAD = median(|x_i - median(x)|)
```
Unlike mean/std, MAD is **immune to outliers**. A single frame with a 10px YOLO glitch won't corrupt the statistic.

| Scenario | Mean displacement | MAD displacement |
|---|---|---|
| Parked truck, 1 big glitch | **High** (fooled!) | **Low** (robust ✅) |
| Moving excavator, smooth | High | High |
| Idle crane, steady jitter | Medium | Low |

**Step 3 — Logistic Regression:**
```python
z = LR_INTERCEPT + LR_COEF_MAD_CENTROID × MAD_centroid + LR_COEF_MAD_AREA × MAD_area
p_active = 1 / (1 + e^(-z))
```

| Variable | Default | Meaning |
|---|---|---|
| `LR_INTERCEPT` | -2.0 | Bias toward idle (must overcome inertia) |
| `LR_COEF_MAD_CENTROID` | 2.0 | Weight for position change |
| `LR_COEF_MAD_AREA` | 0.02 | Weight for size change |
| `LR_ACTIVE_THRESHOLD` | 0.5 | Decision boundary |

**Decision boundary examples:**
- Idle machine: MAD_centroid ≈ 0.3, MAD_area ≈ 10 → z = -2.0 + 0.6 + 0.2 = -1.2 → p = 0.23 → **IDLE**
- Active machine: MAD_centroid ≈ 2.0, MAD_area ≈ 100 → z = -2.0 + 4.0 + 2.0 = 4.0 → p = 0.98 → **ACTIVE**

---

## 11. Advanced Feature 2 — ConfMOT: Confidence-Based Adaptive Kalman Filter

### The Problem
When two workers walk past each other, their bounding boxes temporarily merge or flicker. Standard trackers either:
- **Accept the bad coordinate** → Path jumps wildly → False collision predictions
- **Use appearance features (DeepSORT)** → Requires a second neural network → Halves FPS

### The Solution
Use the YOLO confidence score (which naturally drops during occlusions) as a direct proxy for measurement reliability:

```
K = clamp(confidence, 0.0, 1.0)

trusted_position = predicted_position + K × (measured_position - predicted_position)
```

| Confidence | K | Behavior |
|---|---|---|
| 0.95 | 0.95 | Trust the camera. Snap to measurement. |
| 0.50 | 0.50 | Half trust. Blend prediction and measurement. |
| 0.25 | 0.25 | Mostly trust prediction. Measurement is probably junk. |

**Result:** Workers glide smoothly through occlusions instead of teleporting. Zero FPS impact.

---

## 12. Advanced Feature 3 — Homography-Based Vehicle Speed Measurement

### The Math

```python
# 1. Extract tire contact point (bottom-center of machine bbox)
foot_cx = (x1 + x2) / 2.0
foot_cy = y2  # Bottom edge

# 2. Project to real-world meters via Homography
real_xy = cv2.perspectiveTransform([[foot_cx, foot_cy]], H)

# 3. Store with timestamp
history.append((cx, cy, area, real_x, real_y, timestamp))

# 4. Calculate speed over 1.5s window
distance_m = sqrt((wx2-wx1)² + (wy2-wy1)²)
speed_ms   = distance_m / dt
speed_kmh  = speed_ms × 3.6
```

**Why bottom-edge, not center?** The center of a machine's bounding box shifts vertically as the arm moves (excavator) or load changes (crane). The tire contact point on the ground plane is stable and represents true translational motion.

**Display:** Speed appears as an overlay on the machine's label: `"excavator | 4.2 km/h"`

---

## 13. Advanced Feature 4 — Posture-Dependent Safety Ellipses

### Posture Classification (Pseudo-Keypoints)

Since we use YOLOv8s (object detection) not YOLOv8s-pose (skeleton tracking), we estimate posture from **bounding box geometry**:

```python
aspect_ratio = width / height

if aspect_ratio > 1.3:    posture = "FALLEN"    # Box is flat/horizontal
elif aspect_ratio > 0.6:  posture = "STOOPED"   # Box is squarish
else:                     posture = "UPRIGHT"   # Box is tall/vertical
```

### Facing Direction (from Kalman Velocity)

```python
vx, vy = tracker.estimate_velocity(track_id)
if speed > 1.0:
    blind_angle = degrees(atan2(-vy, -vx))  # Opposite to travel direction
else:
    blind_angle = 270  # Default: assume facing camera
```

### Ellipse Geometry

| Posture | Blind Spot Coverage | Ellipse Color | Interpretation |
|---|---|---|---|
| **UPRIGHT** | 160° arc behind worker | Light orange | Normal peripheral vision, narrow rear blind spot |
| **STOOPED** | 240° arc behind worker | Bright orange | Looking down = compressed FOV, massive blind spot |
| **FALLEN** | 360° full circle | Red | Zero situational awareness |

The ellipses are rendered at 30% opacity on a separate overlay and blended underneath all other annotations, creating a "heat map" of dangerous zones around each worker.

---

## 14. Smart Alert Dispatch System

The system uses a sophisticated multi-layered deduplication engine to prevent alert fatigue:

### Per-Worker Cooldowns

| Alert Type | Cooldown | Rationale |
|---|---|---|
| `machinery_proximity` | 120s (2 min) | Worker near machine — don't re-alert every frame |
| `fall_no_movement` | 60s (1 min) | Matches the detection threshold |
| `no_movement` | 60s (1 min) | One alert per idle period |

### Aggregated Zone Alerts

Instead of alerting once per worker per zone, the system aggregates:

```
"3 workers in Restricted Zone A" (single alert)
```

**Re-alert logic:**
- **Time floor:** Re-alert every 120 seconds as a periodic reminder
- **Count jump:** If 2+ additional workers enter within 30 seconds, immediate re-alert
- **Grace period:** If zone empties for <5 seconds (workers briefly stepping out), don't reset

### Aggregated PPE Alerts

Same pattern as zones:
```
"4 workers missing helmets on Camera CAM01" (single alert)
```

### Snapshot Deduplication

```python
_SNAPSHOT_COOLDOWN_SECS = 30
```
If the same alert type fires within 30 seconds, the previous snapshot is reused (avoids filling disk with near-identical images).

---

## 15. Environment Variable Reference

### Detection & Tracking

| Variable | Default | Description |
|---|---|---|
| `YOLO_MODEL` | `custom_safety_best.pt` | Path to YOLO model file |
| `FRAME_SKIP` | `2` | Process every Nth frame |
| `PREDICTION_HORIZON` | `2` | Frames to project forward |
| `PREDICTIVE_COOLDOWN_FRAMES` | `15` | Min frames between predictive alerts |
| `MIN_HISTORY_FOR_PREDICTION` | `3` | Min position history for prediction |
| `HISTORY_WINDOW_FRAMES` | `5` | Worker position memory (frames) |
| `MIN_VELOCITY_PX` | `3.0` | Min speed (px/frame) for prediction |
| `MAX_PREDICT_DISTANCE` | `200.0` | Max distance (px) for prediction |

### Machine Idle Detection (Logistic Regression)

| Variable | Default | Description |
|---|---|---|
| `MACHINE_HISTORY_WINDOW` | `15` | Rolling window (~1.5s at 10 FPS) |
| `LR_INTERCEPT` | `-2.0` | Logistic regression bias |
| `LR_COEF_MAD_CENTROID` | `2.0` | Centroid MAD weight |
| `LR_COEF_MAD_AREA` | `0.02` | Area MAD weight |
| `LR_ACTIVE_THRESHOLD` | `0.5` | Probability threshold |

### No-Movement Detection

| Variable | Default | Description |
|---|---|---|
| `STILL_THRESHOLD_PX` | `8.0` | Movement below this = stationary |
| `FALL_ASPECT_RATIO` | `1.3` | Width/height ratio for fall detection |
| `FALL_STILL_ALERT_SECS` | `60` | Alert after 1 min if fallen |
| `UPRIGHT_STILL_ALERT_SECS` | `300` | Alert after 5 min if upright idle |

### Spatial & Distance

| Variable | Default | Description |
|---|---|---|
| `MACHINE_MARGIN` | `100` | Pixel danger zone margin (no homography) |
| `REFERENCE_OBJECT_REAL_CM` | `30.0` | Known object size for 2D calibration |
| `REFERENCE_OBJECT_PX` | `60.0` | Known object pixel size |

### Rendering

| Variable | Default | Description |
|---|---|---|
| `BODY_CUBE_DEPTH_RATIO` | `0.35` | Body cube depth relative to width |
| `BODY_CUBE_PERSPECTIVE` | `0.6` | Perspective offset factor |

### Network

| Variable | Default | Description |
|---|---|---|
| `EXPRESS_URL` | `http://localhost:5000` | Express backend URL |
| `INTERNAL_API_KEY` | `supersecretkey123` | API key for alert dispatch |
| `PYTHON_PORT` | `8000` | FastAPI server port |

### PPE Persistence

| Variable | Default | Description |
|---|---|---|
| `PPE_CONFIRM_SECS` | `1.5` | Seconds to confirm PPE violation |
| `PPE_CLEAR_GRACE_SECS` | `0.5` | Grace period before clearing |

---

## 16. Frontend Integration — How It All Shows Up

### Visual Output (Video Stream)

The React frontend renders the AI output via a simple `<img>` tag:
```html
<img src="http://localhost:8000/stream/CAM01" />
```

**Everything drawn by OpenCV (zones, ellipses, body cubes, labels, speed overlays) is baked into the JPEG pixels.** The frontend does zero rendering — it just displays the image. This means:
- ✅ All 4 advanced features are immediately visible
- ✅ Works on any browser, any device
- ✅ No WebGL, no Canvas, no frontend GPU required
- ✅ The stream works even on a basic `<img>` tag in plain HTML

### Data Output (REST Alerts)

When the AI fires an alert, it POSTs a JSON payload to the Express backend:
```
Python AI → POST /api/alerts → Express → MongoDB → WebSocket → React Dashboard
```

The React dashboard receives:
- 🔔 Real-time notification toast
- 📊 Updated alert counters
- 📸 Snapshot image linked from `/snapshots/`
- 📋 Full metadata (worker ID, zone ID, distance, speed, etc.)

### What Each Feature Adds to the Frontend View

| Feature | Visual on Stream | Data to Dashboard |
|---|---|---|
| **Idle Detection** | Only moving machines get proximity checks | Eliminates false machinery alerts |
| **ConfMOT Tracking** | Smooth, stable bounding boxes | Stable track IDs in alert metadata |
| **Vehicle Speed** | `"excavator | 4.2 km/h"` on machine label | `machine_speed` field in alerts |
| **Safety Ellipses** | Colored arcs on the floor | `worker_status: STOOPED` in metadata |
| **Body Cubes** | 3D wireframe around workers | (visual only) |
| **Predictive Collision** | Dashed cyan box at predicted position | `predicted_bbox` coordinates |
| **PPE Violations** | Red `NO HELMET` / `NO VEST` labels | `helmet_missing` / `vest_missing` alerts |
| **Zone Intrusion** | Colored polygon overlays | `restricted_zone` alerts with worker count |
| **Fall Detection** | Magenta body cube + `POSTURE: FALLEN` | `fall_no_movement` alert |
| **Distance Labels** | `"3.42 m"` next to each worker | Distance in alert metadata |

---

*This document covers the complete technical implementation of the EyeOnSite AI/ML service as of v2.1. All mathematical models, configuration parameters, and data flows described here are production code running in the repository.*
