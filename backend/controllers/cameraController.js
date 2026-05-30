const Camera = require('../models/Camera');
const Zone = require('../models/Zone');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { getSiteFilter, hasSiteAccess } = require('../utils/siteFilter');

const AI_URL = process.env.EXPRESS_URL ? undefined : `http://localhost:${process.env.PYTHON_PORT || 8000}`;

function getAiUrl() {
  return `http://localhost:${process.env.PYTHON_PORT || 8000}`;
}

// Generate unique camera IDs using a monotonically increasing counter
async function generateCameraId() {
  const cameras = await Camera.find({}, { camera_id: 1 }).lean();
  let maxNum = 0;
  for (const c of cameras) {
    const match = c.camera_id && c.camera_id.match(/^cam(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }
  return `cam${maxNum + 1}`;
}

exports.createCamera = async (req, res) => {
  try {
    const { name, source_type, source_path, is_active } = req.body;

    if (!name || name.length < 3 || name.length > 80) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'name must be 3-80 characters' }
      });
    }

    if (!['live', 'rtsp', 'video'].includes(source_type)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'source_type must be live, rtsp, or video' }
      });
    }

    if (!source_path && source_path !== '0') {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'source_path is required' }
      });
    }

    if (source_type === 'live') {
      const idx = parseInt(source_path, 10);
      if (isNaN(idx) || idx < 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'source_path for live must be a non-negative integer' }
        });
      }
    }

    // Determine site_id: use req.body.site_id (admin can specify), else use user's siteId
    let site_id = '';
    if (req.user) {
      if (req.user.role === 'admin' && req.body.site_id) {
        site_id = req.body.site_id;
        const hasAccess = await hasSiteAccess(req.user, site_id);
        if (!hasAccess) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'No access to this site' }
          });
        }
      } else {
        site_id = req.user.siteId || '';
      }
    }

    const camera_id = await generateCameraId();

    // Check duplicate
    const existing = await Camera.findOne({ camera_id });
    if (existing) {
      return res.status(409).json({
        success: false,
        error: { code: 'CONFLICT', message: 'Duplicate camera_id' }
      });
    }

    const camera = await Camera.create({
      camera_id,
      name,
      source_type,
      source_path,
      site_id,
      is_active: is_active !== undefined ? is_active : true
    });

    // Register with Python AI service in detection mode immediately
    let aiStatus = 'running';
    try {
      await axios.post(`${getAiUrl()}/register_camera`, {
        camera_id,
        source_type,
        source_path,
        paused: false
      });
    } catch (aiErr) {
      console.error('[Camera] Failed to register with AI service:', aiErr.message);
      aiStatus = 'ai_unavailable';
    }

    res.status(201).json({
      success: true,
      data: { camera_id, site_id, status: aiStatus }
    });
  } catch (err) {
    console.error('[Camera] Create error:', err);
    res.status(500).json({
      success: false,
      error: { code: 'DB_ERROR', message: err.message }
    });
  }
};

exports.getAllCameras = async (req, res) => {
  try {
    // Site-scoped filtering
    const siteFilter = await getSiteFilter(req.user);
    const cameras = await Camera.find(siteFilter).lean();

    // Try to get health status from AI service
    let healthMap = {};
    let aiServiceDown = true;
    try {
      const resp = await axios.get(`${getAiUrl()}/health/cameras`);
      if (resp.data) {
        healthMap = resp.data;
        aiServiceDown = false;
      }
    } catch {
      // AI service unavailable — continue without health info
    }

    // Auto-heal missing cameras if AI service is running
    if (!aiServiceDown) {
      for (const c of cameras) {
        if (!healthMap[c.camera_id] && c.is_active) {
          try {
            console.log(`[Auto-heal] Re-registering ${c.camera_id} with AI service`);
            await axios.post(`${getAiUrl()}/register_camera`, {
              camera_id: c.camera_id,
              source_type: c.source_type,
              source_path: c.source_path,
              paused: false
            });
            const zones = await Zone.find({ camera_id: c.camera_id }).lean();
            if (zones.length > 0) {
              await axios.post(`${getAiUrl()}/update_zone`, {
                camera_id: c.camera_id,
                zones: zones
              });
            }
            healthMap[c.camera_id] = { status: 'starting' };
          } catch (err) {
            console.error(`[Auto-heal] Failed to re-register ${c.camera_id}:`, err.message);
          }
        }
      }
    }

    const data = cameras.map(c => ({
      camera_id: c.camera_id,
      name: c.name,
      source_type: c.source_type,
      source_path: c.source_path,
      site_id: c.site_id,
      is_active: c.is_active,
      created_at: c.created_at,
      health: healthMap[c.camera_id] || 'unknown'
    }));

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'DB_ERROR', message: err.message }
    });
  }
};

exports.activateCamera = async (req, res) => {
  try {
    const { camera_id } = req.params;
    const camera = await Camera.findOne({ camera_id });
    if (!camera) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Camera not found' }
      });
    }

    // Site access check
    const hasAccess = await hasSiteAccess(req.user, camera.site_id);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'No access to this camera' }
      });
    }

    try {
      await axios.post(`${getAiUrl()}/activate_camera`, { camera_id });
    } catch (aiErr) {
      console.error('[Camera] Failed to activate in AI service:', aiErr.message);
      return res.status(502).json({
        success: false,
        error: { code: 'AI_ERROR', message: 'Failed to activate camera in AI service' }
      });
    }

    res.json({ success: true, data: { camera_id, status: 'activated' } });
  } catch (err) {
    console.error('[Camera] Activate error:', err);
    res.status(500).json({
      success: false,
      error: { code: 'DB_ERROR', message: err.message }
    });
  }
};

exports.pauseCamera = async (req, res) => {
  try {
    const { camera_id } = req.params;
    const camera = await Camera.findOne({ camera_id });
    if (!camera) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Camera not found' }
      });
    }

    // Site access check
    const hasAccess = await hasSiteAccess(req.user, camera.site_id);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'No access to this camera' }
      });
    }

    try {
      await axios.post(`${getAiUrl()}/pause_camera`, { camera_id });
    } catch (aiErr) {
      console.error('[Camera] Failed to pause in AI service:', aiErr.message);
      return res.status(502).json({
        success: false,
        error: { code: 'AI_ERROR', message: 'Failed to pause camera in AI service' }
      });
    }
    res.json({ success: true, data: { camera_id, status: 'paused' } });
  } catch (err) {
    console.error('[Camera] Pause error:', err);
    res.status(500).json({
      success: false,
      error: { code: 'DB_ERROR', message: err.message }
    });
  }
};

exports.cameraStatus = async (req, res) => {
  try {
    const { camera_id } = req.params;
    let status = 'unknown';
    let paused = false;
    try {
      const resp = await axios.get(`${getAiUrl()}/camera_status/${camera_id}`);
      if (resp.data) {
        status = resp.data.status;
        paused = resp.data.paused;
      }
    } catch (aiErr) {
      // AI service unavailable
    }
    res.json({ success: true, data: { camera_id, status, paused } });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'DB_ERROR', message: err.message }
    });
  }
};

exports.updateCamera = async (req, res) => {
  try {
    const { camera_id } = req.params;
    const camera = await Camera.findOne({ camera_id });

    if (!camera) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Camera not found' }
      });
    }

    // Site access check
    const hasAccess = await hasSiteAccess(req.user, camera.site_id);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'No access to this camera' }
      });
    }

    const sourceChanged = req.body.source_type !== undefined || req.body.source_path !== undefined;

    // Apply updates
    if (req.body.name) camera.name = req.body.name;
    if (req.body.source_type) camera.source_type = req.body.source_type;
    if (req.body.source_path !== undefined) camera.source_path = req.body.source_path;
    if (req.body.is_active !== undefined) camera.is_active = req.body.is_active;
    // Only admin can reassign site
    if (req.body.site_id && req.user && req.user.role === 'admin') {
      const allowed = await hasSiteAccess(req.user, req.body.site_id);
      if (!allowed) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Cannot assign to this site' } });
      }
      camera.site_id = req.body.site_id;
    }

    await camera.save();

    // If source changed, stop and re-register, then activate
    if (sourceChanged) {
      try {
        await axios.post(`${getAiUrl()}/stop_camera`, { camera_id });
        await axios.post(`${getAiUrl()}/register_camera`, {
          camera_id,
          source_type: camera.source_type,
          source_path: camera.source_path
        });
        const zones = await Zone.find({ camera_id }).lean();
        if (zones.length > 0) {
          await axios.post(`${getAiUrl()}/update_zone`, {
            camera_id,
            zones: zones
          });
        }
        await axios.post(`${getAiUrl()}/activate_camera`, { camera_id });
      } catch (aiErr) {
        console.error('[Camera] Failed to re-register or activate with AI service:', aiErr.message);
      }
    }

    res.json({ success: true, data: camera });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'DB_ERROR', message: err.message }
    });
  }
};

exports.deleteCamera = async (req, res) => {
  try {
    const { camera_id } = req.params;
    const camera = await Camera.findOne({ camera_id });

    if (!camera) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Camera not found' }
      });
    }

    // Site access check
    const hasAccess = await hasSiteAccess(req.user, camera.site_id);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'No access to this camera' }
      });
    }

    // Stop AI thread
    try {
      await axios.post(`${getAiUrl()}/stop_camera`, { camera_id });
    } catch {
      // AI service may be down — continue
    }

    // Delete camera and related zones (keep alerts for history)
    await Camera.deleteOne({ camera_id });
    await Zone.deleteMany({ camera_id });

    // Delete uploaded video file if this was a video camera
    if (camera.source_type === 'video' && camera.source_path) {
      const uploadPath = path.join(__dirname, '..', camera.source_path);
      fs.unlink(uploadPath, () => { });
    }

    res.json({ success: true, message: 'Camera deleted' });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'DB_ERROR', message: err.message }
    });
  }
};
