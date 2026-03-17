"""
CameraThread: Per-camera processing thread.
Handles frame capture, YOLO detection, spatial logic, predictive analysis,
frame annotation, and alert dispatch.
"""

import os
import sys
import time
import threading
import collections
import cv2
import numpy as np
import requests
from datetime import datetime, timezone

from detection import run_tracking, categorize_detections
from spatial_logic import check_violations, is_inside_zone, get_danger_zone, euclidean_distance_cm
from tracker import WorkerTracker
from zones import zone_manager

EXPRESS_URL = os.environ.get("EXPRESS_URL", "http://localhost:5000")
INTERNAL_API_KEY = os.environ.get("INTERNAL_API_KEY", "supersecretkey123")
FRAME_SKIP = int(os.environ.get("FRAME_SKIP", 2))
SNAPSHOTS_DIR = os.path.join(os.path.dirname(__file__), "..", "server", "snapshots")
PPE_ALERT_TYPES = {"helmet_missing", "vest_missing"}
FALL_ALERT_TYPES = {"fall_no_movement"}

# Body cube config (SOP Feature 3)
BODY_CUBE_DEPTH_RATIO  = float(os.environ.get("BODY_CUBE_DEPTH_RATIO", 0.35))
BODY_CUBE_PERSPECTIVE  = float(os.environ.get("BODY_CUBE_PERSPECTIVE", 0.6))

os.makedirs(SNAPSHOTS_DIR, exist_ok=True)

# Thread state constants
STATE_INIT     = "init"
STATE_STARTING = "starting"
STATE_RUNNING  = "running"
STATE_DEGRADED = "degraded"
STATE_STOPPING = "stopping"
STATE_STOPPED  = "stopped"


# ── Status colour palette (SOP Feature 5) ────────────────────────────────────
STATUS_COLORS = {
    "OK":    (0, 200, 0),     # green
    "PPE":   (0, 0, 220),     # red
    "ZONE":  (0, 140, 255),   # orange
    "STILL": (200, 0, 200),   # purple
    "MACH":  (0, 80, 255),    # blue
}


def get_worker_status(violations):
    """Return highest-severity status string for a worker's violation list."""
    types = {v["type"] for v in violations}
    if "helmet_missing"       in types: return "PPE"
    if "vest_missing"         in types: return "PPE"
    if "fall_no_movement"     in types: return "PPE"   # Fallen worker — highest priority
    if "no_movement"          in types: return "STILL"
    if "machinery_proximity"  in types: return "MACH"
    if "restricted_zone"      in types: return "ZONE"
    return "OK"


def draw_worker_tag(frame, bbox, track_id, status="OK", distance_cm=None, violations=None):
    """
    Draw a colour-coded filled pill label above a worker's bounding box,
    plus the coloured rectangle itself. (SOP Feature 5)
    """
    x1, y1, x2, y2 = [int(v) for v in bbox]
    color = STATUS_COLORS.get(status, (200, 200, 200))

    label = f"Worker #{track_id}"
    
    # Prepend specific violation types to the label if there are any
    if violations and len(violations) > 0:
        v_types = [v["type"] for v in violations]
        # format: e.g. "no_helmet, no_vest | Worker #5"
        label = f"{', '.join(v_types)} | {label}"

    if distance_cm is not None:
        label += f" | {distance_cm:.0f} cm"

    font       = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = 0.5
    thickness  = 1
    (tw, th), _ = cv2.getTextSize(label, font, font_scale, thickness)

    pad = 5
    # Filled background pill
    cv2.rectangle(frame,
                  (x1, y1 - th - pad * 2 - 2),
                  (x1 + tw + pad * 2, y1),
                  color, -1)
    cv2.putText(frame, label,
                (x1 + pad, y1 - pad - 1),
                font, font_scale, (255, 255, 255), thickness, cv2.LINE_AA)
    # Bounding box
    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
    return frame


def draw_body_cube(frame, bbox, color=(0, 255, 200), alpha=0.6):
    """
    Overlay a pseudo-3D wireframe box (body cube) around a tracked person.
    Uses perspective offset trick on a 2D frame. (SOP Feature 3)
    """
    x1, y1, x2, y2 = [int(v) for v in bbox]
    d      = int((x2 - x1) * BODY_CUBE_DEPTH_RATIO)
    offset = int(d * BODY_CUBE_PERSPECTIVE)

    front = [(x1, y1), (x2, y1), (x2, y2), (x1, y2)]
    back  = [(x1 + offset, y1 - offset),
             (x2 + offset, y1 - offset),
             (x2 + offset, y2 - offset),
             (x1 + offset, y2 - offset)]

    overlay = frame.copy()

    # Front face
    pts   = np.array(front, dtype=np.int32)
    cv2.polylines(overlay, [pts], isClosed=True, color=color, thickness=2)
    # Back face
    pts_b = np.array(back, dtype=np.int32)
    cv2.polylines(overlay, [pts_b], isClosed=True, color=color, thickness=1)
    # Depth edges
    for f, b in zip(front, back):
        cv2.line(overlay, f, b, color, 1)

    cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0, frame)
    return frame


def draw_status_legend(frame):
    """
    Draw a small colour legend in the top-right corner of the frame.
    Makes the demo self-explanatory for judges. (SOP Feature 5)
    """
    labels = [
        ("OK — Compliant",     STATUS_COLORS["OK"]),
        ("PPE Violation",      STATUS_COLORS["PPE"]),
        ("Restricted Zone",    STATUS_COLORS["ZONE"]),
        ("Near Machinery",     STATUS_COLORS["MACH"]),
        ("Worker Stationary",  STATUS_COLORS["STILL"]),
    ]
    h, w = frame.shape[:2]
    box_x = w - 220
    box_y = 10
    box_w = 210
    row_h = 22
    total_h = row_h * len(labels) + 8

    # Semi-transparent background
    overlay = frame.copy()
    cv2.rectangle(overlay, (box_x - 5, box_y - 5),
                  (box_x + box_w, box_y + total_h), (30, 30, 30), -1)
    cv2.addWeighted(overlay, 0.6, frame, 0.4, 0, frame)

    for i, (text, color) in enumerate(labels):
        y = box_y + 8 + i * row_h
        cv2.rectangle(frame, (box_x, y), (box_x + 14, y + 14), color, -1)
        cv2.putText(frame, text, (box_x + 18, y + 11),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.42, (240, 240, 240), 1, cv2.LINE_AA)
    return frame

class CameraThread(threading.Thread):
    def __init__(self, camera_id, source, source_type="video", paused=False):
        super().__init__(daemon=True)
        self.camera_id = camera_id
        self.source = source
        self.source_type = source_type
        self.running = True
        self.paused = paused  # When True, stream frames but skip detection
        self._reset_video = False  # Flag to reset video to start on activate
        self.state = STATE_INIT
        self.lock = threading.Lock()
        self.latest_frame = None
        self.latest_frame_jpeg = None
        self.fps = 0.0
        self.frame_count = 0
        self.tracker = WorkerTracker()
        self._retry_count = 0
        self._max_retries = 20
        # Machinery proximity: per-worker cooldown
        self._alert_cooldown = {}  # { (track_id, alert_type): last_timestamp }
        self._MACHINERY_COOLDOWN_SECS = 120  # 2 minutes
        # Snapshot dedup: { alert_type: (timestamp, snapshot_url) }
        self._snapshot_cache = {}
        self._SNAPSHOT_COOLDOWN_SECS = 30
        
        # 3D Homography and Reliability
        self.homography_matrix = None
        self.alert_retry_queue = collections.deque(maxlen=100)
        
        # Zone presence: track workers currently inside restricted zones
        # Key: (track_id, zone_id)
        self._zone_presence = set()

        # --- Smart alert state ---
        # Zone alerts: count-aware + time floor + grace period
        self._zone_alert_state = {}  # { zone_id: { last_alert_time, last_alert_count, zero_since } }
        self._ZONE_TIME_FLOOR = 120      # 2-min periodic reminder
        self._ZONE_JUMP_MIN_GAP = 30     # 30s min gap for count-jump re-alerts
        self._ZONE_GRACE_SECS = 5        # 5s grace before resetting on count=0

        # PPE alerts: count-aware + time floor + grace period
        self._ppe_alert_state = {}  # { v_type: { last_alert_time, last_alert_count, zero_since } }
        self._PPE_TIME_FLOOR = 180       # 3-min periodic reminder
        self._PPE_JUMP_MIN_GAP = 30      # 30s min gap for count-jump re-alerts
        self._PPE_GRACE_SECS = 5         # 5s grace before resetting on count=0
        self._ppe_persistence = {}  # { (track_id, v_type): { first_seen, clear_since, violation } }
        self._PPE_CONFIRM_SECS = float(os.environ.get("PPE_CONFIRM_SECS", 1.5))
        self._PPE_CLEAR_GRACE_SECS = float(os.environ.get("PPE_CLEAR_GRACE_SECS", 0.5))

    def _filter_ppe_violations(self, track_id, violations, now_ts):
        confirmed = []
        active_ppe_types = set()

        for violation in violations:
            v_type = violation["type"]
            if v_type not in PPE_ALERT_TYPES:
                confirmed.append(violation)
                continue

            active_ppe_types.add(v_type)
            state_key = (track_id, v_type)
            state = self._ppe_persistence.get(state_key)

            if state is None:
                state = {
                    "first_seen": now_ts,
                    "clear_since": None,
                    "violation": violation,
                }
                self._ppe_persistence[state_key] = state
            else:
                state["clear_since"] = None
                state["violation"] = violation

            if now_ts - state["first_seen"] >= self._PPE_CONFIRM_SECS:
                confirmed.append(state["violation"])

        track_keys = [
            key for key in self._ppe_persistence
            if key[0] == track_id and key[1] in PPE_ALERT_TYPES and key[1] not in active_ppe_types
        ]
        for state_key in track_keys:
            state = self._ppe_persistence[state_key]
            if state["clear_since"] is None:
                state["clear_since"] = now_ts
            if now_ts - state["clear_since"] >= self._PPE_CLEAR_GRACE_SECS:
                del self._ppe_persistence[state_key]
                continue
            if now_ts - state["first_seen"] >= self._PPE_CONFIRM_SECS:
                confirmed.append(state["violation"])

        return confirmed

    def _open_capture(self):
        """Open video capture from source."""
        if self.source_type == "live":
            src = int(self.source)
        elif self.source_type == "rtsp":
            src = self.source
        else:
            # Video file - resolve path
            src = self.source
            if not os.path.isabs(src):
                # Try relative to project root (server/uploads) or ai_service
                for base in [
                    os.path.join(os.path.dirname(__file__), ".."),
                    os.path.join(os.path.dirname(__file__), "..", "server"),
                    os.path.dirname(__file__),
                ]:
                    candidate = os.path.join(base, src)
                    if os.path.exists(candidate):
                        src = candidate
                        break

        cap = cv2.VideoCapture(src)
        return cap

    def _fire_alert(self, alert_type, metadata, frame):
        """Send alert to Express backend (non-blocking)."""
        try:
            timestamp = datetime.now(timezone.utc)

            # Reuse recent snapshot if same alert type fired within cooldown
            cached = self._snapshot_cache.get(alert_type)
            if cached and (timestamp.timestamp() - cached[0]) < self._SNAPSHOT_COOLDOWN_SECS:
                snapshot_url = cached[1]
            else:
                import uuid
                uid = uuid.uuid4().hex[:8]
                snapshot_name = f"{self.camera_id}_{alert_type}_{int(timestamp.timestamp())}_{uid}.png"
                snapshot_path = os.path.join(SNAPSHOTS_DIR, snapshot_name)
                # Save snapshot in a thread to avoid blocking
                snap_frame = frame.copy()
                threading.Thread(
                    target=cv2.imwrite,
                    args=(snapshot_path, snap_frame),
                    daemon=True,
                ).start()
                snapshot_url = f"/snapshots/{snapshot_name}"
                self._snapshot_cache[alert_type] = (timestamp.timestamp(), snapshot_url)

            # Send HTTP request in a thread to avoid blocking the processing loop
            payload = {
                "camera_id": self.camera_id,
                "type": alert_type,
                "timestamp": timestamp.isoformat(),
                "snapshot_url": snapshot_url,
                "metadata": metadata,
            }
            threading.Thread(
                target=self._send_alert_request,
                args=(payload,),
                daemon=True,
            ).start()
        except Exception as e:
            print(f"[{self.camera_id}] Alert dispatch error: {e}")

    def _send_alert_request(self, payload, is_retry=False):
        """Send alert HTTP request (runs in a separate thread)."""
        try:
            resp = requests.post(
                f"{EXPRESS_URL}/api/alerts",
                json=payload,
                headers={"x-internal-key": INTERNAL_API_KEY},
                timeout=3,
            )
            resp.raise_for_status()
            if is_retry:
                print(f"[{self.camera_id}] Successfully dispatched buffered alert.")
        except Exception as e:
            if not is_retry:
                print(f"[{self.camera_id}] Alert send error, buffering... ({e})")
            with self.lock:
                self.alert_retry_queue.append(payload)

    def _annotate_frame(self, frame, persons, helmets, no_helmets, vests, no_vests, machines, violations_map, predictive_map, zones):
        """Draw bounding boxes, zones, body cubes, worker tags and status legend on frame."""
        annotated = frame.copy()

        # Draw zones
        for zone in zones:
            coords = zone.get("coordinates", [])
            zone_type = zone.get("zone_type", "restricted")
            color = (0, 0, 255) if zone_type == "restricted" else (0, 165, 255) if zone_type == "proximity" else (0, 255, 0)
            
            if len(coords) >= 6:
                pts = np.array(coords, np.int32).reshape((-1, 2))
                
                # Draw filled polygon with alpha
                overlay = annotated.copy()
                cv2.fillPoly(overlay, [pts], color)
                cv2.addWeighted(overlay, 0.2, annotated, 0.8, 0, annotated)
                
                # Draw outline
                cv2.polylines(annotated, [pts], isClosed=True, color=color, thickness=2)
                
                label = zone.get("name") or zone.get("zone_id", zone_type)
                # Ensure label is string and coordinates are Python ints
                cv2.putText(annotated, str(label), (int(pts[0][0]), int(pts[0][1]) - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
                
            elif len(coords) == 4:
                x1, y1, x2, y2 = [int(c) for c in coords]
                cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
                label = zone.get("name") or zone.get("zone_id", zone_type)
                cv2.putText(annotated, str(label), (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)

        # Draw machines
        for machine in machines:
            x1, y1, x2, y2 = [int(c) for c in machine["bbox"]]
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (255, 165, 0), 2)
            cv2.putText(annotated, machine.get("class", "machine"), (x1, y1 - 5),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 165, 0), 1)

        # Draw persons — body cube + worker tag + distance (SOP Features 3, 5, 2)
        for person in persons:
            track_id = person.get("track_id", -1)
            person_bbox = person["bbox"]

            violations = violations_map.get(track_id, [])
            has_prediction = track_id in predictive_map and len(predictive_map[track_id]) > 0

            status = get_worker_status(violations)
            # Elevate to MACH colour for predictive warnings when otherwise safe
            if has_prediction and status == "OK":
                status = "MACH"

            cube_color = STATUS_COLORS.get(status, (0, 200, 0))

            # Feature 3: Body cube wireframe
            annotated = draw_body_cube(annotated, person_bbox, color=cube_color)

            # Feature 2: Distance to nearest machine label
            nearest_dist_cm = None
            if machines:
                dists = [euclidean_distance_cm(person_bbox, m["bbox"]) for m in machines]
                nearest_dist_cm = min(dists)

            # Feature 5: Styled Worker tag
            annotated = draw_worker_tag(annotated, person_bbox, track_id,
                                        status=status, distance_cm=nearest_dist_cm, violations=violations)

            # Draw predictive dashed bbox
            if has_prediction:
                for warning in predictive_map[track_id]:
                    pred_bbox = warning.get("metadata", {}).get("predicted_bbox")
                    if pred_bbox:
                        px1, py1, px2, py2 = [int(c) for c in pred_bbox]
                        for i in range(px1, px2, 10):
                            cv2.line(annotated, (i, py1), (min(i + 5, px2), py1), (0, 255, 255), 1)
                            cv2.line(annotated, (i, py2), (min(i + 5, px2), py2), (0, 255, 255), 1)
                        for i in range(py1, py2, 10):
                            cv2.line(annotated, (px1, i), (px1, min(i + 5, py2)), (0, 255, 255), 1)
                            cv2.line(annotated, (px2, i), (px2, min(i + 5, py2)), (0, 255, 255), 1)

        # Draw matched helmets/vests (small indicators)
        for h in helmets:
            x1, y1, x2, y2 = [int(c) for c in h["bbox"]]
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 200, 0), 1)

        for nh in no_helmets:
            x1, y1, x2, y2 = [int(c) for c in nh["bbox"]]
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 0, 255), 1)
            cv2.putText(annotated, "NO HELMET", (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 255), 1)

        for v in vests:
            x1, y1, x2, y2 = [int(c) for c in v["bbox"]]
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (200, 200, 0), 1)

        for nv in no_vests:
            x1, y1, x2, y2 = [int(c) for c in nv["bbox"]]
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 0, 255), 1)
            cv2.putText(annotated, "NO VEST", (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 255), 1)

        # Feature 5: Status legend (top-right corner)
        annotated = draw_status_legend(annotated)

        # Indicate if camera is 3D Calibrated
        if self.homography_matrix is not None:
            cv2.putText(annotated, "3D CALIBRATED (Meters)", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
        else:
            cv2.putText(annotated, "2D PIXEL MODE (Uncalibrated)", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 165, 255), 2)

        return annotated

    def run(self):
        self.state = STATE_STARTING
        cap = self._open_capture()

        if not cap.isOpened():
            print(f"[{self.camera_id}] Failed to open source: {self.source}")
            self.state = STATE_STOPPED
            return

        self.state = STATE_RUNNING
        print(f"[{self.camera_id}] Camera thread started")

        frame_time_start = time.time()
        consecutive_failures = 0

        while self.running:
            loop_start_time = time.time()
            # Check if video should be reset (on activate)
            if self._reset_video:
                self._reset_video = False
                self.frame_count = 0
                if self.source_type == "video":
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

            ret, frame = cap.read()

            if not ret:
                consecutive_failures += 1
                if self.source_type == "video":
                    # Loop video for demo
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    consecutive_failures = 0
                    continue
                elif consecutive_failures > self._max_retries:
                    if self.source_type == "rtsp":
                        print(f"[{self.camera_id}] RTSP reconnecting...")
                        cap.release()
                        time.sleep(2)
                        cap = self._open_capture()
                        consecutive_failures = 0
                    else:
                        print(f"[{self.camera_id}] Too many failures, stopping")
                        break
                self.state = STATE_DEGRADED
                time.sleep(0.1)
                continue

            consecutive_failures = 0
            if self.state == STATE_DEGRADED:
                self.state = STATE_RUNNING

            self.frame_count += 1

            # Frame sampling
            if self.frame_count % FRAME_SKIP != 0:
                continue

            # If paused, just stream raw frames without detection
            if self.paused:
                ret_enc, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
                with self.lock:
                    self.latest_frame = frame.copy()
                    if ret_enc:
                        self.latest_frame_jpeg = jpeg.tobytes()
                # Throttle to ~20 FPS to avoid burning through video
                time.sleep(1.0 / 20.0)
                continue

            # Flush alert retry queue if any (max 5 per frame to avoid blocking)
            if self.alert_retry_queue:
                to_retry = []
                with self.lock:
                    while self.alert_retry_queue and len(to_retry) < 5:
                        to_retry.append(self.alert_retry_queue.popleft())
                
                for payload in to_retry:
                    threading.Thread(
                        target=self._send_alert_request,
                        args=(payload, True),
                        daemon=True,
                    ).start()

            # Run YOLO tracking
            detections = run_tracking(frame)
            persons, helmets, no_helmets, vests, no_vests, machines = categorize_detections(detections)

            # Get current zones
            zones = zone_manager.get_zones(self.camera_id)

            violations_map = {}  # track_id -> [violations]
            predictive_map = {}  # track_id -> [warnings]

            machine_bboxes = [m["bbox"] for m in machines]
            active_track_ids = set()

            # Track machinery movement and filter out stationary machines
            active_machine_keys = set()
            for i, machine in enumerate(machines):
                m_key = f"machine_{machine.get('track_id', i)}"
                active_machine_keys.add(m_key)
                self.tracker.update_machine_position(m_key, machine["bbox"])

            moving_machines = []
            for i, machine in enumerate(machines):
                m_key = f"machine_{machine.get('track_id', i)}"
                if self.tracker.is_machine_moving(m_key):
                    moving_machines.append(machine)

            self.tracker.cleanup_stale_machines(active_machine_keys)
            moving_machine_bboxes = [m["bbox"] for m in moving_machines]

            pending_alerts = []  # collect (alert_type, metadata) to fire with annotated frame
            ppe_workers_this_frame = {}  # { v_type: set(track_ids) }
            zone_workers_this_frame = {}  # { zone_id: set(track_ids) }

            for person in persons:
                track_id = person.get("track_id", -1)
                active_track_ids.add(track_id)
                person_bbox = person["bbox"]

                # Reactive checks — only alert for moving machinery
                raw_violations = check_violations(
                    person, no_helmets, no_vests, moving_machines, zones, H=self.homography_matrix
                )

                now = time.time()
                violations = self._filter_ppe_violations(track_id, raw_violations, now)
                violations_map[track_id] = violations

                # Update position history
                self.tracker.update_position(track_id, person_bbox)

                # Feature 4: No-movement / fall detection
                still_alert_type, still_secs = self.tracker.check_no_movement(track_id, person_bbox)
                if still_alert_type is not None:
                    violations.append({
                        "type": still_alert_type,  # 'fall_no_movement' or 'no_movement'
                        "metadata": {
                            "worker_track_id": f"track_{track_id}",
                            "still_seconds": still_secs,
                        }
                    })

                # Predictive checks — only for moving machinery
                if self.tracker.has_enough_history(track_id):
                    predictive_warnings = self.tracker.check_predictive_collisions(
                        track_id, person_bbox, zones, moving_machine_bboxes
                    )
                    filtered_warnings = []
                    for warning in predictive_warnings:
                        if self.tracker.should_fire_predictive_alert(
                            track_id, warning["type"], self.frame_count
                        ):
                            pending_alerts.append((warning["type"], warning["metadata"]))
                            filtered_warnings.append(warning)
                    predictive_map[track_id] = filtered_warnings

                # Collect reactive alerts to fire
                current_zones = set()
                for violation in violations:
                    v_type = violation["type"]
                    zone_id = violation.get("metadata", {}).get("zone_id")

                    if v_type == "restricted_zone" and zone_id:
                        # Collect for per-zone aggregation (handled after the loop)
                        presence_key = (track_id, zone_id)
                        current_zones.add(presence_key)
                        self._zone_presence.add(presence_key)
                        if zone_id not in zone_workers_this_frame:
                            zone_workers_this_frame[zone_id] = set()
                        zone_workers_this_frame[zone_id].add(track_id)
                    elif v_type in ("helmet_missing", "vest_missing"):
                        # Collect for per-camera aggregation (handled after the loop)
                        if v_type not in ppe_workers_this_frame:
                            ppe_workers_this_frame[v_type] = set()
                        ppe_workers_this_frame[v_type].add(track_id)
                    else:
                        # Machinery proximity: 2-minute cooldown per worker
                        cooldown_key = (track_id, v_type)
                        last_t = self._alert_cooldown.get(cooldown_key, 0)
                        if now - last_t >= self._MACHINERY_COOLDOWN_SECS:
                            self._alert_cooldown[cooldown_key] = now
                            pending_alerts.append((v_type, violation["metadata"]))

                # Remove zone presence for zones the worker has left
                stale_zone_keys = [
                    k for k in self._zone_presence if k[0] == track_id and k not in current_zones
                ]
                for k in stale_zone_keys:
                    self._zone_presence.discard(k)

            # Cleanup stale tracks
            self.tracker.cleanup_stale(active_track_ids)
            # Cleanup zone presence for workers no longer tracked
            self._zone_presence = {
                k for k in self._zone_presence if k[0] in active_track_ids
            }
            # Prune stale cooldown entries for workers no longer tracked
            self._alert_cooldown = {
                k: v for k, v in self._alert_cooldown.items()
                if k[0] in active_track_ids
            }
            self._ppe_persistence = {
                k: v for k, v in self._ppe_persistence.items()
                if k[0] in active_track_ids
            }

            # --- Smart zone alerts: count-aware with grace period ---
            now_zone = time.time()
            active_zone_ids = set(zone_workers_this_frame.keys())
            for zone_id in list(self._zone_alert_state.keys()):
                if zone_id not in active_zone_ids:
                    state = self._zone_alert_state[zone_id]
                    if state.get("zero_since") is None:
                        state["zero_since"] = now_zone
                    elif now_zone - state["zero_since"] >= self._ZONE_GRACE_SECS:
                        del self._zone_alert_state[zone_id]

            for zone_id, worker_ids in zone_workers_this_frame.items():
                count = len(worker_ids)
                state = self._zone_alert_state.get(zone_id)
                should_alert = False

                if state is None:
                    should_alert = True
                    self._zone_alert_state[zone_id] = {
                        "last_alert_time": now_zone,
                        "last_alert_count": count,
                        "zero_since": None,
                    }
                else:
                    state["zero_since"] = None
                    time_since = now_zone - state["last_alert_time"]
                    count_jump = count - state["last_alert_count"]

                    if count_jump >= 2 and time_since >= self._ZONE_JUMP_MIN_GAP:
                        should_alert = True
                    elif time_since >= self._ZONE_TIME_FLOOR:
                        should_alert = True

                    if should_alert:
                        state["last_alert_time"] = now_zone
                        state["last_alert_count"] = count

                if should_alert:
                    pending_alerts.append(("restricted_zone", {
                        "zone_id": zone_id,
                        "worker_count": count,
                        "worker_track_ids": [f"track_{tid}" for tid in worker_ids],
                    }))

            # --- Smart PPE alerts: count-aware with grace period ---
            now_ppe = time.time()
            active_ppe_types = set(ppe_workers_this_frame.keys())
            for v_type in list(self._ppe_alert_state.keys()):
                if v_type not in active_ppe_types:
                    state = self._ppe_alert_state[v_type]
                    if state.get("zero_since") is None:
                        state["zero_since"] = now_ppe
                    elif now_ppe - state["zero_since"] >= self._PPE_GRACE_SECS:
                        del self._ppe_alert_state[v_type]

            for v_type, worker_ids in ppe_workers_this_frame.items():
                count = len(worker_ids)
                state = self._ppe_alert_state.get(v_type)
                should_alert = False

                if state is None:
                    should_alert = True
                    self._ppe_alert_state[v_type] = {
                        "last_alert_time": now_ppe,
                        "last_alert_count": count,
                        "zero_since": None,
                    }
                else:
                    state["zero_since"] = None
                    time_since = now_ppe - state["last_alert_time"]
                    count_jump = count - state["last_alert_count"]

                    if count_jump >= 2 and time_since >= self._PPE_JUMP_MIN_GAP:
                        should_alert = True
                    elif time_since >= self._PPE_TIME_FLOOR:
                        should_alert = True

                    if should_alert:
                        state["last_alert_time"] = now_ppe
                        state["last_alert_count"] = count

                if should_alert:
                    pending_alerts.append((v_type, {
                        "worker_count": count,
                        "worker_track_ids": [f"track_{tid}" for tid in worker_ids],
                    }))

            # Annotate frame
            annotated = self._annotate_frame(
                frame, persons, helmets, no_helmets, vests, no_vests, machines,
                violations_map, predictive_map, zones
            )

            # Fire all pending alerts with the annotated snapshot
            for alert_type, metadata in pending_alerts:
                self._fire_alert(alert_type, metadata, annotated)

            # Store latest frame as pre-encoded JPEG for immediate broadcasting
            ret, jpeg = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 80])
            with self.lock:
                if ret:
                    self.latest_frame_jpeg = jpeg.tobytes()

            # FPS calculation
            elapsed = time.time() - frame_time_start
            if elapsed > 0:
                self.fps = self.frame_count / elapsed

            # Enforce target framerate to 20 FPS
            time_to_sleep = (1.0 / 20.0) - (time.time() - loop_start_time)
            if time_to_sleep > 0:
                time.sleep(time_to_sleep)

        self.state = STATE_STOPPING
        cap.release()
        self.state = STATE_STOPPED
        print(f"[{self.camera_id}] Camera thread stopped")

    def get_frame_jpeg(self):
        """Get the latest pre-encoded JPEG frame (thread-safe)."""
        with self.lock:
            return self.latest_frame_jpeg

    def stop(self):
        """Signal the thread to stop."""
        self.running = False
