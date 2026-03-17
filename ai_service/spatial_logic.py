"""
Spatial logic engine for construction safety.
Handles bbox collision, PPE association, machinery proximity, violations,
and pixel-to-real-world distance calculation.
"""

import os
import math

MACHINE_MARGIN = int(os.environ.get("MACHINE_MARGIN", 100))

# ── Distance Calculation (SOP Feature 2) ──────────────────────────────────────
# Calibrate by measuring a known object (e.g. a helmet ~30 cm wide)
# at mid-scene distance, then counting its pixel width in the image.
REFERENCE_OBJECT_REAL_CM = float(os.environ.get("REFERENCE_OBJECT_REAL_CM", 30.0))
REFERENCE_OBJECT_PX = float(os.environ.get("REFERENCE_OBJECT_PX", 60.0))
PX_PER_CM = REFERENCE_OBJECT_PX / REFERENCE_OBJECT_REAL_CM  # pixels per centimetre


def get_centre(bbox):
    """Return (cx, cy) centre of a bounding box [x1,y1,x2,y2]."""
    x1, y1, x2, y2 = bbox
    return ((x1 + x2) / 2.0, (y1 + y2) / 2.0)


def get_ground_position(bbox, H=None):
    """Get the foot-point of a bbox, optionally transformed by Homography matrix H to real-world meters."""
    import numpy as np
    wx1, wy1, wx2, wy2 = bbox
    foot_cx = (wx1 + wx2) / 2.0
    foot_cy = float(wy2)
    if H is not None:
        import cv2
        pt = np.array([[[foot_cx, foot_cy]]], dtype=np.float32)
        real_pt = cv2.perspectiveTransform(pt, np.array(H, dtype=np.float32))
        return real_pt[0][0][0], real_pt[0][0][1]
    return foot_cx, foot_cy


def transform_zone_to_meters(zone_coords, H):
    """Transform pixel polygon to real-world meters."""
    import numpy as np
    import cv2
    pts = np.array(zone_coords, np.float32).reshape((-1, 1, 2))
    real_pts = cv2.perspectiveTransform(pts, np.array(H, dtype=np.float32))
    return real_pts.reshape(-1).tolist()


def pixel_distance_to_cm(px_distance: float) -> float:
    """Convert a pixel distance to centimetres using the calibrated scale."""
    if PX_PER_CM == 0:
        return 0.0
    return px_distance / PX_PER_CM


def euclidean_distance_cm(bbox_a, bbox_b) -> float:
    """
    Compute the straight-line distance between the centres of two bounding
    boxes and return the result in centimetres.
    """
    cx1, cy1 = get_centre(bbox_a)
    cx2, cy2 = get_centre(bbox_b)
    px_dist = math.sqrt((cx2 - cx1) ** 2 + (cy2 - cy1) ** 2)
    return pixel_distance_to_cm(px_dist)


def is_inside_zone(worker_bbox, zone_bbox):
    """
    Check if worker bounding box overlaps with a zone bounding box.
    Both are [x1, y1, x2, y2] format.
    """
    wx1, wy1, wx2, wy2 = worker_bbox
    zx1, zy1, zx2, zy2 = zone_bbox
    return wx1 < zx2 and wx2 > zx1 and wy1 < zy2 and wy2 > zy1


def is_foot_in_zone(worker_bbox, zone_coords, H=None):
    """
    Check if the worker's ground position is inside a polygon zone.
    zone_coords is a list of [x1, y1, x2, y2, x3, y3, ...]
    """
    import cv2
    import numpy as np
    
    foot_cx, foot_cy = get_ground_position(worker_bbox, H)
    
    if len(zone_coords) < 6:
        # Fallback for old rectangular zones [x1, y1, x2, y2]
        if len(zone_coords) == 4:
            zx1, zy1, zx2, zy2 = zone_coords
            if H is not None:
                poly = [zx1, zy1, zx2, zy1, zx2, zy2, zx1, zy2]
                real_poly = transform_zone_to_meters(poly, H)
                pts = np.array(real_poly, np.float32).reshape((-1, 2))
                dist = cv2.pointPolygonTest(pts, (foot_cx, foot_cy), measureDist=False)
                return dist >= 0
            else:
                return (zx1 <= foot_cx <= zx2) and (zy1 <= foot_cy <= zy2)
        return False

    if H is not None:
        zone_coords = transform_zone_to_meters(zone_coords, H)
    
    pts = np.array(zone_coords, np.float32).reshape((-1, 2))
    
    # pointPolygonTest returns +1 if inside, 0 if on edge, -1 if outside
    dist = cv2.pointPolygonTest(pts, (foot_cx, foot_cy), measureDist=False)
    return dist >= 0


def get_danger_zone(machine_bbox, margin=None):
    """
    Expand machine bounding box by safety margin to create danger zone.
    """
    if margin is None:
        margin = MACHINE_MARGIN
    x1, y1, x2, y2 = machine_bbox
    return [x1 - margin, y1 - margin, x2 + margin, y2 + margin]


def find_explicit_violation(person_bbox, explicitly_missing_list):
    """
    Instead of assuming a worker is violating PPE rules because we couldn't find a helmet
    overlapping with them, we now look for an explicit 'no_helmet' or 'no_vest' detection
    that securely overlaps with their person bounding box.
    """
    for missing_item in explicitly_missing_list:
        # If the 'no_helmet' or 'no_vest' bounding box is largely inside the person's bbox,
        # we can confidently say this specific person is missing it.
        mx1, my1, mx2, my2 = missing_item["bbox"]
        px1, py1, px2, py2 = person_bbox
        
        # Check geometric overlap
        overlap_horizontal = (mx1 < px2) and (mx2 > px1)
        overlap_vertical = (my1 < py2) and (my2 > py1)
        
        if overlap_horizontal and overlap_vertical:
            return True
    return False


def check_violations(person, no_helmets, no_vests, machines, zones, H=None):
    """
    Check all violations for a single person using custom explicit-class ML rules.

    Args:
        person: dict with 'bbox', 'track_id'
        no_helmets: list of deliberate "no_helmet" detections output by custom ML
        no_vests: list of deliberate "no_vest" detections output by custom ML
        machines: list of machine detections
        zones: list of zone configs with 'coordinates', 'rules', 'zone_id', 'zone_type'
        H: Optional 3x3 Homography matrix for real-world distance checks

    Returns:
        list of violation dicts: [{ "type": str, "metadata": dict }, ...]
    """
    violations = []
    person_bbox = person["bbox"]
    track_id = person.get("track_id", -1)

    # PPE checks — using our custom model's exact predictions
    # If the ML explicitly detected a 'no_helmet' on this person, trigger violation.
    is_missing_helmet = find_explicit_violation(person_bbox, no_helmets)
    is_missing_vest = find_explicit_violation(person_bbox, no_vests)

    if is_missing_helmet:
        violations.append({
            "type": "helmet_missing",
            "metadata": {
                "worker_track_id": f"track_{track_id}",
            }
        })

    if is_missing_vest:
        violations.append({
            "type": "vest_missing",
            "metadata": {
                "worker_track_id": f"track_{track_id}",
            }
        })

    # Zone-based violations
    for zone in zones:
        if zone.get("zone_type") not in ("restricted", "proximity"):
            continue
        in_zone = is_foot_in_zone(person_bbox, zone["coordinates"], H)
        if in_zone:
            # Restricted zone entry
            if zone.get("zone_type") == "restricted":
                violations.append({
                    "type": "restricted_zone",
                    "metadata": {
                        "worker_track_id": f"track_{track_id}",
                        "zone_id": zone.get("zone_id"),
                        "worker_bbox": person_bbox,
                    }
                })

    MACHINE_MARGIN_METERS = 2.0  # 2 meters safe distance
    # Machinery proximity
    for machine in machines:
        if H is not None:
            wx, wy = get_ground_position(person_bbox, H)
            mx, my = get_ground_position(machine["bbox"], H)
            dist_meters = math.sqrt((wx - mx)**2 + (wy - my)**2)
            if dist_meters < MACHINE_MARGIN_METERS:
                violations.append({
                    "type": "machinery_proximity",
                    "metadata": {
                        "worker_track_id": f"track_{track_id}",
                        "machine_bbox": machine["bbox"],
                        "machine_class": machine.get("class"),
                        "distance_m": round(dist_meters, 2)
                    }
                })
        else:
            danger_zone = get_danger_zone(machine["bbox"])
            if is_inside_zone(person_bbox, danger_zone):
                violations.append({
                    "type": "machinery_proximity",
                    "metadata": {
                        "worker_track_id": f"track_{track_id}",
                        "machine_bbox": machine["bbox"],
                        "machine_class": machine.get("class"),
                    }
                })

    return violations
