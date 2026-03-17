"""
YOLO model loading and inference for custom construction safety detection.

Strategy:
  - If custom_safety_best.pt exists → use it (6 explicit classes)
  - Otherwise → use YOLOv8s-World (open-vocabulary zero-shot detection)
    with text prompts: "person", "helmet", "safety vest", "heavy machinery"
    Then we infer "no_helmet" / "no_vest" by checking which persons
    do NOT have a helmet/vest overlapping them.
"""

import os
import threading
from ultralytics import YOLO

# Ensure thread-safe YOLO inference to prevent freezing with multiple cameras
_inference_lock = threading.Lock()

# ── Custom model class mapping (used when custom_safety_best.pt is loaded) ──
CUSTOM_CLASS_NAMES = {
    0: "person",
    1: "helmet",
    2: "no_helmet",
    3: "vest",
    4: "no_vest",
    5: "machinery"
}

# ── World model text prompts (used when falling back to yolov8s-worldv2.pt) ──
WORLD_CLASSES = ["person", "hard hat", "safety vest", "excavator", "crane", "bulldozer", "truck"]
# Mapping from World model output class names to our internal names
WORLD_TO_INTERNAL = {
    "person": "person",
    "hard hat": "helmet",
    "safety vest": "vest",
    "excavator": "machinery",
    "crane": "machinery",
    "bulldozer": "machinery",
    "truck": "machinery",
}

# Confidence thresholds
PERSON_CONF = 0.40
HELMET_CONF = 0.35
NO_HELMET_CONF = 0.35
VEST_CONF = 0.35
NO_VEST_CONF = 0.35
MACHINERY_CONF = 0.45
NMS_IOU = 0.45
TRACK_MATCH_THRESH = 0.70

# IoU threshold for associating PPE with a person
PPE_ASSOCIATION_IOU = 0.05

_model = None
_using_world_model = False


def _iou(box_a, box_b):
    """Compute IoU between two [x1, y1, x2, y2] boxes."""
    x1 = max(box_a[0], box_b[0])
    y1 = max(box_a[1], box_b[1])
    x2 = min(box_a[2], box_b[2])
    y2 = min(box_a[3], box_b[3])
    if x2 <= x1 or y2 <= y1:
        return 0.0
    inter = (x2 - x1) * (y2 - y1)
    area_a = (box_a[2] - box_a[0]) * (box_a[3] - box_a[1])
    area_b = (box_b[2] - box_b[0]) * (box_b[3] - box_b[1])
    return inter / max(area_a + area_b - inter, 1e-6)


def _contains_vertically(person_bbox, item_bbox):
    """Check if item_bbox's center falls within the horizontal span and upper portion of person."""
    px1, py1, px2, py2 = person_bbox
    ix1, iy1, ix2, iy2 = item_bbox
    item_cx = (ix1 + ix2) / 2
    item_cy = (iy1 + iy2) / 2
    # Item center must be within person's horizontal span
    if item_cx < px1 or item_cx > px2:
        return False
    # Item center must be within person's vertical span
    if item_cy < py1 or item_cy > py2:
        return False
    return True


def get_model():
    """Load and return the YOLO model (singleton)."""
    global _model, _using_world_model
    with _inference_lock:
        if _model is None:
            # Try custom model first
            custom_path = os.environ.get("YOLO_MODEL", "custom_safety_best.pt")
            ai_dir = os.path.dirname(__file__)

            # Check multiple locations for the custom model
            custom_candidates = [
                custom_path,
                os.path.join(ai_dir, custom_path),
                os.path.join(ai_dir, "custom_safety_best.pt"),
            ]

            loaded = False
            for path in custom_candidates:
                if os.path.exists(path):
                    _model = YOLO(path)
                    _using_world_model = False
                    loaded = True
                    print(f"[Detection] ✅ Loaded CUSTOM model: {path}")
                    break

            if not loaded:
                # Fall back to World model for zero-shot detection
                world_path = os.path.join(ai_dir, "yolov8s-worldv2.pt")
                if not os.path.exists(world_path):
                    world_path = "yolov8s-worldv2.pt"

                if os.path.exists(world_path):
                    _model = YOLO(world_path)
                    _model.set_classes(WORLD_CLASSES)
                    _using_world_model = True
                    print(f"[Detection] 🌍 Loaded WORLD model (zero-shot): {world_path}")
                    print(f"[Detection]    Classes: {WORLD_CLASSES}")
                else:
                    # Last resort: plain yolov8s (only person detection will work)
                    fallback = os.path.join(ai_dir, "yolov8s.pt")
                    if not os.path.exists(fallback):
                        fallback = "yolov8s.pt"
                    _model = YOLO(fallback)
                    _using_world_model = False
                    print(f"[Detection] ⚠️  Loaded FALLBACK model: {fallback} (PPE detection DISABLED)")

    return _model


def run_detection(frame):
    """
    Run YOLO detection on a single frame.

    Returns list of dicts:
        [{ "class": str, "confidence": float, "bbox": [x1,y1,x2,y2] }, ...]
    """
    model = get_model()
    with _inference_lock:
        results = model.predict(
            frame,
            conf=min(PERSON_CONF, HELMET_CONF, VEST_CONF, MACHINERY_CONF),
            iou=NMS_IOU,
            verbose=False,
        )

    detections = []
    if results and len(results) > 0:
        result = results[0]
        boxes = result.boxes
        if boxes is not None:
            for box in boxes:
                cls_id = int(box.cls[0])
                conf = float(box.conf[0])
                bbox = box.xyxy[0].tolist()

                if _using_world_model:
                    # World model: map class name via result.names
                    raw_name = result.names.get(cls_id, "unknown")
                    class_name = WORLD_TO_INTERNAL.get(raw_name, raw_name)
                else:
                    # Custom model: use our explicit class map
                    class_name = CUSTOM_CLASS_NAMES.get(cls_id, result.names.get(cls_id, "unknown"))

                # Apply per-class confidence threshold
                thresholds = {
                    "person": PERSON_CONF,
                    "helmet": HELMET_CONF,
                    "no_helmet": NO_HELMET_CONF,
                    "vest": VEST_CONF,
                    "no_vest": NO_VEST_CONF,
                    "machinery": MACHINERY_CONF,
                }
                min_conf = thresholds.get(class_name, 0.5)
                if conf < min_conf:
                    continue

                detections.append({
                    "class": class_name,
                    "confidence": conf,
                    "bbox": bbox,
                })

    return detections


def run_tracking(frame):
    """
    Run YOLO tracking on a single frame (uses ByteTrack).

    Returns list of dicts:
        [{ "class": str, "confidence": float, "bbox": [x1,y1,x2,y2], "track_id": int }, ...]
    """
    model = get_model()
    with _inference_lock:
        results = model.track(
            frame,
            conf=min(PERSON_CONF, HELMET_CONF, VEST_CONF, MACHINERY_CONF),
            iou=NMS_IOU,
            tracker="bytetrack.yaml",
            persist=True,
            verbose=False,
        )

    detections = []
    if results and len(results) > 0:
        result = results[0]
        boxes = result.boxes
        if boxes is not None:
            for box in boxes:
                cls_id = int(box.cls[0])
                conf = float(box.conf[0])
                bbox = box.xyxy[0].tolist()
                track_id = int(box.id[0]) if box.id is not None else -1

                if _using_world_model:
                    raw_name = result.names.get(cls_id, "unknown")
                    class_name = WORLD_TO_INTERNAL.get(raw_name, raw_name)
                else:
                    class_name = CUSTOM_CLASS_NAMES.get(cls_id, result.names.get(cls_id, "unknown"))

                thresholds = {
                    "person": PERSON_CONF,
                    "helmet": HELMET_CONF,
                    "no_helmet": NO_HELMET_CONF,
                    "vest": VEST_CONF,
                    "no_vest": NO_VEST_CONF,
                    "machinery": MACHINERY_CONF,
                }
                min_conf = thresholds.get(class_name, 0.5)
                if conf < min_conf:
                    continue

                detections.append({
                    "class": class_name,
                    "confidence": conf,
                    "bbox": bbox,
                    "track_id": track_id,
                })

    return detections


def _infer_missing_ppe(persons, helmets, vests):
    """
    For the WORLD model: since it can only detect "helmet" and "vest" (positive),
    we infer "no_helmet" and "no_vest" by checking which persons do NOT have
    a matching helmet/vest overlapping or contained within them.

    Returns: (no_helmets_list, no_vests_list)
    """
    no_helmets = []
    no_vests = []

    for person in persons:
        p_bbox = person["bbox"]

        # Check if any helmet overlaps/is inside this person
        has_helmet = False
        for h in helmets:
            if _contains_vertically(p_bbox, h["bbox"]) or _iou(p_bbox, h["bbox"]) > PPE_ASSOCIATION_IOU:
                has_helmet = True
                break

        if not has_helmet:
            # Generate a synthetic "no_helmet" bbox in the head region
            px1, py1, px2, py2 = p_bbox
            head_h = (py2 - py1) * 0.2
            no_helmets.append({
                "class": "no_helmet",
                "confidence": 0.80,
                "bbox": [px1, py1, px2, py1 + head_h],
            })

        # Check if any vest overlaps/is inside this person
        has_vest = False
        for v in vests:
            if _contains_vertically(p_bbox, v["bbox"]) or _iou(p_bbox, v["bbox"]) > PPE_ASSOCIATION_IOU:
                has_vest = True
                break

        if not has_vest:
            # Generate a synthetic "no_vest" bbox in the torso region
            px1, py1, px2, py2 = p_bbox
            torso_top = py1 + (py2 - py1) * 0.2
            torso_bot = py1 + (py2 - py1) * 0.6
            no_vests.append({
                "class": "no_vest",
                "confidence": 0.80,
                "bbox": [px1, torso_top, px2, torso_bot],
            })

    return no_helmets, no_vests


def categorize_detections(detections):
    """
    Split detections into categorized lists.
    When using the World model, also infer no_helmet/no_vest from missing PPE.

    Returns:
        persons, helmets, no_helmets, vests, no_vests, machines
    """
    persons = []
    helmets = []
    no_helmets = []
    vests = []
    no_vests = []
    machines = []

    for det in detections:
        cls = det["class"]
        if cls == "person":
            persons.append(det)
        elif cls == "helmet":
            helmets.append(det)
        elif cls == "no_helmet":
            no_helmets.append(det)
        elif cls == "vest":
            vests.append(det)
        elif cls == "no_vest":
            no_vests.append(det)
        elif cls == "machinery":
            machines.append(det)
        elif cls in ("excavator", "bulldozer", "crane", "truck"):
            machines.append(det)

    # World model inference: create synthetic no_helmet/no_vest detections
    if _using_world_model:
        inferred_no_helmets, inferred_no_vests = _infer_missing_ppe(persons, helmets, vests)
        no_helmets.extend(inferred_no_helmets)
        no_vests.extend(inferred_no_vests)

    return persons, helmets, no_helmets, vests, no_vests, machines
