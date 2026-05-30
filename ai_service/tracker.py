"""
Worker position tracking and predictive collision detection.
Maintains rolling position history per tracked worker across frames.
Also detects worker stillness (no-movement) for safety alerts.
"""

import os
import time
import math
from spatial_logic import get_ground_position

T_HORIZON = int(os.environ.get("PREDICTION_HORIZON", 2))
PREDICTIVE_COOLDOWN_FRAMES = int(os.environ.get("PREDICTIVE_COOLDOWN_FRAMES", 15))
MIN_HISTORY = int(os.environ.get("MIN_HISTORY_FOR_PREDICTION", 3))
HISTORY_WINDOW = int(os.environ.get("HISTORY_WINDOW_FRAMES", 5))
# Minimum velocity (px/frame) to bother predicting — ignore jitter
MIN_VELOCITY_PX = float(os.environ.get("MIN_VELOCITY_PX", 3.0))
# Max distance (px) to zone edge for predictive alert to fire
MAX_PREDICT_DISTANCE = float(os.environ.get("MAX_PREDICT_DISTANCE", 200.0))

# ── Edge-Based Machine Idle Detection (Logistic Regression) ─────────────────
# History window for machinery: ~1.5 s at 10 processed FPS (20 FPS / FRAME_SKIP=2)
MACHINE_HISTORY_WINDOW  = int(os.environ.get("MACHINE_HISTORY_WINDOW",   15))

# Pre-fitted logistic regression coefficients.
# Features: MAD of frame-to-frame centroid displacement (px)
#           MAD of frame-to-frame bounding-box area change (px²)
#
# Decision boundary (empirically tuned on construction-site YOLO detections):
#   idle  machine → MAD_centroid ≈ 0.2–0.5 px,  MAD_area ≈  5– 20 px²  → p ≈ 0.08–0.24
#   active machine → MAD_centroid ≈ 1.0–3.0 px,  MAD_area ≈ 50–200 px²  → p ≈ 0.88–0.99
LR_INTERCEPT         = float(os.environ.get("LR_INTERCEPT",          -2.0))
LR_COEF_MAD_CENTROID = float(os.environ.get("LR_COEF_MAD_CENTROID",   2.0))
LR_COEF_MAD_AREA     = float(os.environ.get("LR_COEF_MAD_AREA",       0.02))
LR_ACTIVE_THRESHOLD  = float(os.environ.get("LR_ACTIVE_THRESHOLD",    0.5))

# Kalman Filter setup (smooths out YOLO box jitter)
# We will use simple exponential moving average (EMA) for velocity if full KF isn't available
VELOCITY_ALPHA = 0.3 # 0.0 to 1.0. Lower = more smoothing, higher = more responsive

# ── No-Movement Detection (SOP Feature 4) ───────────────────────────────────
# Pixel movement below this threshold = worker is considered stationary
STILL_THRESHOLD_PX = float(os.environ.get("STILL_THRESHOLD_PX", 8.0))

# Aspect ratio threshold (width/height): values ABOVE this mean the bbox
# is wider than it is tall → likely fallen/collapsed person
FALL_ASPECT_RATIO = float(os.environ.get("FALL_ASPECT_RATIO", 1.3))

# How long (seconds) a fallen pose + no movement must persist before alerting
FALL_STILL_ALERT_SECS = float(os.environ.get("FALL_STILL_ALERT_SECS", 60.0))   # 1 minute

# How long (seconds) a standing/sitting person must be motionless before alerting
UPRIGHT_STILL_ALERT_SECS = float(os.environ.get("UPRIGHT_STILL_ALERT_SECS", 300.0))  # 5 minutes



class WorkerTracker:
    """Tracks worker and machinery positions across frames for predictive analysis."""

    # (threshold replaced by logistic regression — see is_machine_moving)

    def __init__(self):
        # { track_id: [(cx, cy), ...] }
        self.position_history = {}
        # { track_id: { alert_type: last_frame_number } }
        self.last_predictive_alert = {}
        # { machine_key: [(cx, cy), ...] } for machinery movement tracking
        self.machine_history = {}
        # No-movement detection (SOP Feature 4)
        self.stationary_since = {}  # track_id -> float timestamp when stillness started
        self.last_center      = {}  # track_id -> (cx, cy) from last processed frame
        # ConfMOT Adaptive Kalman Filter states
        self.kf_states        = {}  # track_id -> {"x": cx, "y": cy, "vx": 0, "vy": 0}

    def update_position(self, track_id, bbox, confidence=1.0):
        """
        Update position history using an Adaptive Kalman Filter (ConfMOT).
        Dynamically adjusts the measurement trust (Kalman Gain) based on YOLO confidence.
        """
        cx_meas = (bbox[0] + bbox[2]) / 2.0
        cy_meas = (bbox[1] + bbox[3]) / 2.0

        if track_id not in self.kf_states:
            # Initialize new track
            self.kf_states[track_id] = {"x": cx_meas, "y": cy_meas, "vx": 0.0, "vy": 0.0}
            trusted_cx, trusted_cy = cx_meas, cy_meas
        else:
            state = self.kf_states[track_id]
            
            # 1. Predict Step (Kinematic Model)
            pred_x = state["x"] + state["vx"]
            pred_y = state["y"] + state["vy"]
            
            # 2. Update Step (Adaptive Kalman Gain)
            # High confidence -> K approaches 1 (trust measurement)
            # Low confidence  -> K approaches 0 (trust prediction)
            K = max(0.0, min(1.0, confidence))
            
            trusted_cx = pred_x + K * (cx_meas - pred_x)
            trusted_cy = pred_y + K * (cy_meas - pred_y)
            
            # Adaptive Velocity Smoothing (EMA heavily dampened on low confidence)
            inst_vx = trusted_cx - state["x"]
            inst_vy = trusted_cy - state["y"]
            
            alpha = VELOCITY_ALPHA * K
            state["vx"] = (alpha * inst_vx) + ((1.0 - alpha) * state["vx"])
            state["vy"] = (alpha * inst_vy) + ((1.0 - alpha) * state["vy"])
            
            state["x"] = trusted_cx
            state["y"] = trusted_cy

        if track_id not in self.position_history:
            self.position_history[track_id] = []
        
        # Append the *trusted/smoothed* position, not the noisy raw bounding box
        self.position_history[track_id].append((trusted_cx, trusted_cy))
        # Keep only last N frames
        self.position_history[track_id] = self.position_history[track_id][-HISTORY_WINDOW:]

    def estimate_velocity(self, track_id):
        """
        Return the pre-calculated smoothed velocity from the Adaptive Kalman Filter.
        O(1) execution time.
        Returns: smoothed_vx, smoothed_vy (pixels/frame)
        """
        if track_id in self.kf_states:
            state = self.kf_states[track_id]
            return state["vx"], state["vy"]
        return 0.0, 0.0

    def predict_future_bbox(self, track_id, current_bbox, t=None):
        """Project current bbox forward by t frames using estimated velocity."""
        if t is None:
            t = T_HORIZON
        vx, vy = self.estimate_velocity(track_id)
        x1, y1, x2, y2 = current_bbox
        return [
            x1 + vx * t,
            y1 + vy * t,
            x2 + vx * t,
            y2 + vy * t,
        ]

    def has_enough_history(self, track_id):
        """Check if we have enough position history for prediction."""
        return len(self.position_history.get(track_id, [])) >= MIN_HISTORY

    def should_fire_predictive_alert(self, track_id, alert_type, current_frame):
        """Check cooldown to prevent alert spam."""
        last = self.last_predictive_alert.get(track_id, {}).get(alert_type, -999)
        if current_frame - last >= PREDICTIVE_COOLDOWN_FRAMES:
            self.last_predictive_alert.setdefault(track_id, {})[alert_type] = current_frame
            return True
        return False

    def _distance_to_zone(self, bbox, zone_coords):
        """Estimate pixel distance from bbox center-bottom to nearest zone edge.
        Handles both flat [x1,y1,x2,y2] and polygon [[x,y], ...] coordinate formats.
        """
        cx = (bbox[0] + bbox[2]) / 2
        cy = bbox[3]  # bottom of bbox

        coords = list(zone_coords)
        if coords and isinstance(coords[0], (list, tuple)):
            # Nested [[x,y], ...] format
            xs = [p[0] for p in coords]
            ys = [p[1] for p in coords]
            zx1, zy1, zx2, zy2 = min(xs), min(ys), max(xs), max(ys)
        elif len(coords) == 4:
            # Flat [x1, y1, x2, y2] rectangle
            zx1, zy1, zx2, zy2 = coords
        else:
            # Flat polygon [x0,y0,x1,y1,...] — extract bounding box from pairs
            xs = coords[0::2]
            ys = coords[1::2]
            zx1, zy1, zx2, zy2 = min(xs), min(ys), max(xs), max(ys)

        # Clamp to nearest point on zone bounding box
        nearest_x = max(zx1, min(cx, zx2))
        nearest_y = max(zy1, min(cy, zy2))
        return ((cx - nearest_x) ** 2 + (cy - nearest_y) ** 2) ** 0.5

    def check_predictive_collisions(self, track_id, current_bbox, zones, machine_bboxes, H=None):
        """
        Check if predicted future position intersects any danger zones.
        Only fires if current position is safe but predicted is not.
        Requires minimum velocity and proximity to avoid false positives.
        """
        from spatial_logic import is_inside_zone, is_foot_in_zone, get_danger_zone, get_real_distance_meters

        # Skip prediction if worker is barely moving (jitter)
        vx, vy = self.estimate_velocity(track_id)
        speed = (vx * vx + vy * vy) ** 0.5
        if speed < MIN_VELOCITY_PX:
            return []

        predicted_bbox = self.predict_future_bbox(track_id, current_bbox)
        warnings = []

        # Check predicted foot-point vs restricted zones
        for zone in zones:
            if zone.get("zone_type") not in ("restricted", "proximity"):
                continue
            coords = zone["coordinates"]
            # Skip if person is too far from zone — prediction can't be reliable
            dist = self._distance_to_zone(current_bbox, coords)
            if dist > MAX_PREDICT_DISTANCE:
                continue
            if is_foot_in_zone(predicted_bbox, coords, H=H):
                # Only warn if worker is NOT already inside
                if not is_foot_in_zone(current_bbox, coords, H=H):
                    warnings.append({
                        "type": "predicted_zone_entry",
                        "metadata": {
                            "worker_track_id": f"track_{track_id}",
                            "zone_id": zone.get("zone_id"),
                            "predicted_bbox": predicted_bbox,
                        }
                    })

        # Check predicted position vs machinery danger zones
        MACHINE_MARGIN_METERS = 2.0
        for machine_bbox in machine_bboxes:
            if H is not None:
                curr_dist = get_real_distance_meters(current_bbox, machine_bbox, H)
                pred_dist = get_real_distance_meters(predicted_bbox, machine_bbox, H)
                if pred_dist < MACHINE_MARGIN_METERS and curr_dist >= MACHINE_MARGIN_METERS:
                    warnings.append({
                        "type": "predicted_machinery_collision",
                        "metadata": {
                            "worker_track_id": f"track_{track_id}",
                            "machine_bbox": machine_bbox,
                            "predicted_bbox": predicted_bbox,
                            "distance_m": round(pred_dist, 2)
                        }
                    })
            else:
                danger_zone = get_danger_zone(machine_bbox)
                if is_inside_zone(predicted_bbox, danger_zone):
                    if not is_inside_zone(current_bbox, danger_zone):
                        warnings.append({
                            "type": "predicted_machinery_collision",
                            "metadata": {
                                "worker_track_id": f"track_{track_id}",
                                "machine_bbox": machine_bbox,
                                "predicted_bbox": predicted_bbox,
                            }
                        })

        return warnings

    def cleanup_stale(self, active_track_ids):
        """Remove tracking data for workers no longer visible."""
        stale = [tid for tid in self.position_history if tid not in active_track_ids]
        for tid in stale:
            del self.position_history[tid]
            self.last_predictive_alert.pop(tid, None)
            self.stationary_since.pop(tid, None)
            self.last_center.pop(tid, None)
            self.kf_states.pop(tid, None)

    def check_no_movement(self, track_id, bbox):
        """
        Detect if a worker has been stationary too long, differentiated by posture:

        - Fallen pose (bbox width/height > FALL_ASPECT_RATIO ≈ 1.3):
            Person appears to be lying down. Alert after FALL_STILL_ALERT_SECS (60s).
            Returns alert_type = 'fall_no_movement'

        - Upright pose (standing / sitting):
            Alert only after UPRIGHT_STILL_ALERT_SECS (300s / 5 min).
            Returns alert_type = 'no_movement'

        Returns:
            (alert_type: str or None, elapsed_secs: float)
        """
        cx = (bbox[0] + bbox[2]) / 2.0
        cy = (bbox[1] + bbox[3]) / 2.0
        now = time.time()

        w = bbox[2] - bbox[0]
        h = bbox[3] - bbox[1]
        aspect_ratio = w / h if h > 0 else 1.0
        is_fallen = aspect_ratio > FALL_ASPECT_RATIO

        if track_id in self.last_center:
            lx, ly = self.last_center[track_id]
            dist = ((cx - lx) ** 2 + (cy - ly) ** 2) ** 0.5

            if dist < STILL_THRESHOLD_PX:
                # Worker is stationary — start/continue timing
                if track_id not in self.stationary_since:
                    self.stationary_since[track_id] = now

                elapsed = now - self.stationary_since[track_id]
                self.last_center[track_id] = (cx, cy)

                if is_fallen:
                    # Fall scenario: alert after 1 minute
                    if elapsed >= FALL_STILL_ALERT_SECS:
                        return "fall_no_movement", round(elapsed, 1)
                else:
                    # Upright idle scenario: alert after 5 minutes
                    if elapsed >= UPRIGHT_STILL_ALERT_SECS:
                        return "no_movement", round(elapsed, 1)

                return None, 0.0
            else:
                # Worker moved — reset stillness timer
                self.stationary_since.pop(track_id, None)

        self.last_center[track_id] = (cx, cy)
        return None, 0.0

    def update_machine_position(self, machine_key, bbox, H=None):
        """Track machinery centre position, bounding-box area, and optionally real-world ground position."""
        cx   = (bbox[0] + bbox[2]) / 2.0
        cy   = (bbox[1] + bbox[3]) / 2.0
        area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])   # px²

        if H is not None:
            # Only compute homography projection + timestamp when calibrated
            wx, wy = get_ground_position(bbox, H)
            entry = (cx, cy, area, wx, wy, time.time())
        else:
            entry = (cx, cy, area)

        if machine_key not in self.machine_history:
            self.machine_history[machine_key] = []
        self.machine_history[machine_key].append(entry)
        self.machine_history[machine_key] = self.machine_history[machine_key][-MACHINE_HISTORY_WINDOW:]

    # ── Edge-Based Idle Detection ────────────────────────────────────────────

    @staticmethod
    def _compute_mad(values):
        """
        Median Absolute Deviation (MAD) of a list of floats.
        MAD = median( |x_i - median(x)| )
        Robust to outliers — ideal for noisy YOLO bounding-box metadata.
        """
        if not values:
            return 0.0
        sorted_vals = sorted(values)
        median_val  = sorted_vals[len(sorted_vals) // 2]
        deviations  = sorted([abs(v - median_val) for v in values])
        return deviations[len(deviations) // 2]

    def is_machine_moving(self, machine_key):
        """
        Classify a machine as active (True) or idle (False) using a lightweight
        logistic regression model on bounding-box metadata — zero neural-network
        overhead, safe for real-time edge deployment.

        Features (computed over the last ~1.5 s):
          • MAD of frame-to-frame centroid displacement  (px)
          • MAD of frame-to-frame bounding-box area change (px²)

        Model:  z = LR_INTERCEPT
                      + LR_COEF_MAD_CENTROID * MAD_centroid
                      + LR_COEF_MAD_AREA     * MAD_area
                p_active = sigmoid(z)
        Returns True  if p_active >= LR_ACTIVE_THRESHOLD  (machine is moving)
        Returns False if p_active <  LR_ACTIVE_THRESHOLD  (machine is idle)
        """
        import math
        history = self.machine_history.get(machine_key, [])
        if len(history) < 3:
            # Insufficient data — default to active (conservative / safe)
            return True

        centroid_diffs = []
        area_diffs     = []
        for i in range(1, len(history)):
            cx1, cy1, a1, *_ = history[i - 1]
            cx2, cy2, a2, *_ = history[i]
            displacement = math.sqrt((cx2 - cx1) ** 2 + (cy2 - cy1) ** 2)
            centroid_diffs.append(displacement)
            area_diffs.append(abs(a2 - a1))

        mad_centroid = self._compute_mad(centroid_diffs)
        mad_area     = self._compute_mad(area_diffs)

        # Logistic regression (sigmoid)
        z        = (LR_INTERCEPT
                    + LR_COEF_MAD_CENTROID * mad_centroid
                    + LR_COEF_MAD_AREA     * mad_area)
        p_active = 1.0 / (1.0 + math.exp(-z))

        return p_active >= LR_ACTIVE_THRESHOLD

    def get_machine_speed(self, machine_key):
        """
        Calculate instantaneous vehicle speed in km/h based on real-world
        ground coordinates projected via Homography matrix.
        Returns 0.0 if camera is not calibrated (no homography data).
        """
        history = self.machine_history.get(machine_key, [])
        if len(history) < 2:
            return 0.0

        # Short tuples (cx, cy, area) = no homography, skip speed calc
        if len(history[0]) <= 3:
            return 0.0

        # Compare newest and oldest point in the ~1.5s window
        *_, wx1, wy1, t1 = history[0]
        *_, wx2, wy2, t2 = history[-1]

        dt = t2 - t1
        if dt <= 0.01:
            return 0.0

        dist_meters = math.sqrt((wx2 - wx1) ** 2 + (wy2 - wy1) ** 2)
        speed_kmh = (dist_meters / dt) * 3.6
        return round(speed_kmh, 1)

    def cleanup_stale_machines(self, active_machine_keys):
        """Remove tracking data for machines no longer visible."""
        stale = [k for k in self.machine_history if k not in active_machine_keys]
        for k in stale:
            del self.machine_history[k]
