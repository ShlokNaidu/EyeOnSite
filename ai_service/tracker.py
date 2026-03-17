"""
Worker position tracking and predictive collision detection.
Maintains rolling position history per tracked worker across frames.
Also detects worker stillness (no-movement) for safety alerts.
"""

import os
import time

T_HORIZON = int(os.environ.get("PREDICTION_HORIZON", 2))
PREDICTIVE_COOLDOWN_FRAMES = int(os.environ.get("PREDICTIVE_COOLDOWN_FRAMES", 15))
MIN_HISTORY = int(os.environ.get("MIN_HISTORY_FOR_PREDICTION", 3))
HISTORY_WINDOW = int(os.environ.get("HISTORY_WINDOW_FRAMES", 5))
# Minimum velocity (px/frame) to bother predicting — ignore jitter
MIN_VELOCITY_PX = float(os.environ.get("MIN_VELOCITY_PX", 3.0))
# Max distance (px) to zone edge for predictive alert to fire
MAX_PREDICT_DISTANCE = float(os.environ.get("MAX_PREDICT_DISTANCE", 200.0))

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

    # Minimum pixel movement per frame to consider machinery "moving"
    MACHINE_MOVING_THRESHOLD = 3.0

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

    def update_position(self, track_id, bbox):
        """Update position history for a tracked worker."""
        cx = (bbox[0] + bbox[2]) / 2
        cy = (bbox[1] + bbox[3]) / 2
        if track_id not in self.position_history:
            self.position_history[track_id] = []
        self.position_history[track_id].append((cx, cy))
        # Keep only last N frames
        self.position_history[track_id] = self.position_history[track_id][-HISTORY_WINDOW:]

    def estimate_velocity(self, track_id):
        """
        Estimate smoothed velocity using Exponential Moving Average (EMA).
        This acts as a lightweight Kalman Filter to remove YOLO bounding box jitter.
        Returns: smoothed_vx, smoothed_vy (pixels/frame)
        """
        history = self.position_history.get(track_id, [])
        if len(history) < 2:
            return 0.0, 0.0

        # Calculate a smoothed velocity over the history window
        smoothed_vx, smoothed_vy = 0.0, 0.0
        for i in range(1, len(history)):
            curr_x, curr_y = history[i]
            prev_x, prev_y = history[i-1]
            inst_vx = curr_x - prev_x
            inst_vy = curr_y - prev_y
            
            # EMA Smoothing
            if i == 1:
                smoothed_vx, smoothed_vy = inst_vx, inst_vy
            else:
                smoothed_vx = (VELOCITY_ALPHA * inst_vx) + ((1 - VELOCITY_ALPHA) * smoothed_vx)
                smoothed_vy = (VELOCITY_ALPHA * inst_vy) + ((1 - VELOCITY_ALPHA) * smoothed_vy)
                
        return smoothed_vx, smoothed_vy

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
        """Estimate pixel distance from bbox center-bottom to nearest zone edge."""
        cx = (bbox[0] + bbox[2]) / 2
        cy = bbox[3]  # bottom of bbox
        zx1, zy1, zx2, zy2 = zone_coords
        # Clamp to nearest point on zone rectangle
        nearest_x = max(zx1, min(cx, zx2))
        nearest_y = max(zy1, min(cy, zy2))
        return ((cx - nearest_x) ** 2 + (cy - nearest_y) ** 2) ** 0.5

    def check_predictive_collisions(self, track_id, current_bbox, zones, machine_bboxes):
        """
        Check if predicted future position intersects any danger zones.
        Only fires if current position is safe but predicted is not.
        Requires minimum velocity and proximity to avoid false positives.
        """
        from spatial_logic import is_inside_zone, is_foot_in_zone, get_danger_zone

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
            if is_foot_in_zone(predicted_bbox, coords):
                # Only warn if worker is NOT already inside
                if not is_foot_in_zone(current_bbox, coords):
                    warnings.append({
                        "type": "predicted_zone_entry",
                        "metadata": {
                            "worker_track_id": f"track_{track_id}",
                            "zone_id": zone.get("zone_id"),
                            "predicted_bbox": predicted_bbox,
                        }
                    })

        # Check predicted position vs machinery danger zones
        for machine_bbox in machine_bboxes:
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

    def update_machine_position(self, machine_key, bbox):
        """Track machinery center position across frames."""
        cx = (bbox[0] + bbox[2]) / 2
        cy = (bbox[1] + bbox[3]) / 2
        if machine_key not in self.machine_history:
            self.machine_history[machine_key] = []
        self.machine_history[machine_key].append((cx, cy))
        self.machine_history[machine_key] = self.machine_history[machine_key][-HISTORY_WINDOW:]

    def is_machine_moving(self, machine_key):
        """Check if a machine has moved significantly in recent frames."""
        history = self.machine_history.get(machine_key, [])
        if len(history) < 3:
            # Not enough data yet — assume moving to be safe
            return True
        # Check average displacement over last few frames
        total_displacement = 0
        for i in range(1, len(history)):
            dx = history[i][0] - history[i - 1][0]
            dy = history[i][1] - history[i - 1][1]
            total_displacement += (dx * dx + dy * dy) ** 0.5
        avg_displacement = total_displacement / (len(history) - 1)
        return avg_displacement > self.MACHINE_MOVING_THRESHOLD

    def cleanup_stale_machines(self, active_machine_keys):
        """Remove tracking data for machines no longer visible."""
        stale = [k for k in self.machine_history if k not in active_machine_keys]
        for k in stale:
            del self.machine_history[k]
