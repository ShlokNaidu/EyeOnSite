const Zone = require('../models/Zone');
const Camera = require('../models/Camera');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { hasSiteAccess } = require('../utils/siteFilter');

function getAiUrl() {
  return `http://localhost:${process.env.PYTHON_PORT || 8000}`;
}

exports.createZone = async (req, res) => {
  try {
    const { camera_id, name, zone_type, coordinates, rules } = req.body;

    // Validate camera exists
    const camera = await Camera.findOne({ camera_id });
    if (!camera) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Camera not found' }
      });
    }

    const hasAccess = await hasSiteAccess(req.user, camera.site_id);
    if (!hasAccess) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'No access to this camera' } });
    }

    if (!['restricted', 'proximity', 'safe'].includes(zone_type)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'zone_type must be restricted, proximity, or safe' }
      });
    }

    if (!Array.isArray(coordinates) || coordinates.length < 6 || coordinates.length % 2 !== 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'coordinates must be an array of at least 6 numbers (x, y pairs)' }
      });
    }

    // Validate that all elements are numbers
    const allNumbers = coordinates.every(c => typeof c === 'number');
    if (!allNumbers) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'coordinates must all be numbers' }
      });
    }

    const zone_id = `zone_${uuidv4().slice(0, 8)}`;

    const zone = await Zone.create({
      zone_id,
      name: name || '',
      camera_id,
      zone_type,
      coordinates,
      rules: rules || { helmet_required: true, vest_required: true },
      updated_at: new Date()
    });

    // Push zone update to AI service
    try {
      await axios.post(`${getAiUrl()}/update_zone`, {
        camera_id,
        zone_id,
        name: zone.name,
        zone_type,
        coordinates,
        rules: zone.rules
      });
    } catch (aiErr) {
      console.error('[Zone] Failed to push zone to AI service:', aiErr.message);
    }

    res.status(201).json({ success: true, data: zone });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'DB_ERROR', message: err.message }
    });
  }
};

exports.getZonesForCamera = async (req, res) => {
  try {
    const { camera_id } = req.params;
    const camera = await Camera.findOne({ camera_id });
    if (camera) {
       const hasAccess = await hasSiteAccess(req.user, camera.site_id);
       if (!hasAccess) {
         return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'No access to this camera' } });
       }
    }

    const zones = await Zone.find({ camera_id }).lean();

    res.json({
      success: true,
      data: {
        camera_id,
        zones: zones.map(z => ({
          zone_id: z.zone_id,
          name: z.name,
          zone_type: z.zone_type,
          coordinates: z.coordinates,
          rules: z.rules
        }))
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'DB_ERROR', message: err.message }
    });
  }
};

exports.deleteZone = async (req, res) => {
  try {
    const { zone_id } = req.params;
    const zone = await Zone.findOne({ zone_id });

    if (!zone) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Zone not found' }
      });
    }

    const camera = await Camera.findOne({ camera_id: zone.camera_id });
    if (camera) {
       const hasAccess = await hasSiteAccess(req.user, camera.site_id);
       if (!hasAccess) {
         return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'No access to this zone' } });
       }
    }

    await Zone.deleteOne({ zone_id });

    // Notify AI service to refresh zones for this camera
    try {
      const remainingZones = await Zone.find({ camera_id: zone.camera_id }).lean();
      const AI_BASE = getAiUrl();
      if (remainingZones.length === 0) {
        // No zones left: clear by sending an empty-zones update
        await axios.post(`${AI_BASE}/update_zone`, {
          camera_id: zone.camera_id,
          clear: true
        });
      } else {
        // Re-push all remaining zones so AI service has fresh state
        for (const z of remainingZones) {
          await axios.post(`${AI_BASE}/update_zone`, {
            camera_id: zone.camera_id,
            zone_id: z.zone_id,
            name: z.name,
            zone_type: z.zone_type,
            coordinates: z.coordinates,
            rules: z.rules
          });
        }
      }
    } catch {
      // AI service may be down
    }

    res.json({ success: true, message: 'Zone deleted' });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'DB_ERROR', message: err.message }
    });
  }
};
