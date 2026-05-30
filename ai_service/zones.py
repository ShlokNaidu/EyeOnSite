"""
Zone configuration management for the AI service.
Thread-safe zone storage per camera.
"""

import threading


class ZoneManager:
    """Manages zone configurations for all cameras."""

    def __init__(self):
        self._zones = {}  # { camera_id: [zone_config, ...] }
        self._lock = threading.Lock()

    def update_zone(self, camera_id, zone_data):
        """
        Add or update a zone for a camera.
        zone_data should have: zone_id, zone_type, coordinates, rules
        """
        with self._lock:
            if camera_id not in self._zones:
                self._zones[camera_id] = []

            # If zone_id provided, replace existing
            zone_id = zone_data.get("zone_id")
            if zone_id:
                self._zones[camera_id] = [
                    z for z in self._zones[camera_id] if z.get("zone_id") != zone_id
                ]
            # Always append the new/updated zone
            self._zones[camera_id].append(zone_data)

    def get_zones(self, camera_id):
        """Get all zones for a camera (thread-safe copy)."""
        with self._lock:
            return list(self._zones.get(camera_id, []))

    def set_zones(self, camera_id, zones_list):
        """Replace all zones for a camera with the given list."""
        with self._lock:
            self._zones[camera_id] = list(zones_list)

    def remove_camera(self, camera_id):
        """Remove all zones for a camera."""
        with self._lock:
            self._zones.pop(camera_id, None)


# Global singleton
zone_manager = ZoneManager()
