const fs = require('fs');
const path = require('path');
const Alert = require('../models/Alert');
const Camera = require('../models/Camera');
const { broadcast } = require('../websocket');
const { v4: uuidv4 } = require('uuid');
const { getSiteFilter, hasSiteAccess } = require('../utils/siteFilter');

const SNAPSHOTS_DIR = path.join(__dirname, '..', 'snapshots');

function deleteSnapshotFile(snapshot_url) {
  if (!snapshot_url) return;
  const filename = path.basename(snapshot_url);
  const filePath = path.join(SNAPSHOTS_DIR, filename);
  fs.unlink(filePath, () => { });
}

const VALID_TYPES = [
  'helmet_missing',
  'vest_missing',
  'restricted_zone',
  'machinery_proximity',
  'predicted_machinery_collision',
  'predicted_zone_entry',
  'no_movement',
  'fall_no_movement',
  'proximity_ppe_violation',
];

// Server-side alert cooldown: lightweight backup gate
const alertCooldown = {};
const PREDICTIVE_COOLDOWN_MS = 15 * 1000;
const REACTIVE_MIN_GAP_MS = 5 * 1000;
const PREDICTIVE_TYPES = ['predicted_machinery_collision', 'predicted_zone_entry'];

function getCooldownMs(type) {
  return PREDICTIVE_TYPES.includes(type) ? PREDICTIVE_COOLDOWN_MS : REACTIVE_MIN_GAP_MS;
}

// Using getSiteFilter from siteFilter utility

/**
 * POST /api/alerts — receives alert from AI service (internalAuth, NO JWT)
 * CRITICAL: Resolves site_id from camera_id → camera.site_id
 */
exports.receiveAlert = async (req, res) => {
  try {
    const { camera_id, type, timestamp, snapshot_url, metadata } = req.body;

    if (!camera_id || !type || !timestamp) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'camera_id, type, and timestamp are required' }
      });
    }

    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: `type must be one of: ${VALID_TYPES.join(', ')}` }
      });
    }

    // Cooldown check
    const zoneId = metadata?.zone_id || '';
    const cooldownKey = `${type}__${camera_id}__${zoneId}`;
    const now = Date.now();
    if (alertCooldown[cooldownKey] && now - alertCooldown[cooldownKey] < getCooldownMs(type)) {
      return res.status(200).json({ success: true, data: { skipped: true } });
    }
    alertCooldown[cooldownKey] = now;

    const alert_id = `alert_${uuidv4().slice(0, 12)}`;

    // Look up camera → get name AND site_id (CRITICAL MAPPING)
    let camera_name = camera_id;
    let site_id = '';
    try {
      const cam = await Camera.findOne({ camera_id }).lean();
      if (cam) {
        camera_name = cam.name;
        site_id = cam.site_id || '';
      }
    } catch { }

    const alert = await Alert.create({
      alert_id,
      camera_id,
      camera_name,
      site_id,
      type,
      timestamp: new Date(timestamp),
      snapshot_url: snapshot_url || null,
      metadata: metadata || {},
      status: 'pending'
    });

    // Broadcast via WebSocket
    broadcast('new_alert', {
      alert_id: alert.alert_id,
      camera_id: alert.camera_id,
      camera_name: alert.camera_name,
      site_id: alert.site_id,
      type: alert.type,
      timestamp: alert.timestamp,
      snapshot_url: alert.snapshot_url,
      metadata: alert.metadata,
      status: alert.status
    });

    res.status(201).json({ success: true, data: { alert_id } });
  } catch (err) {
    console.error('[Alert] Ingest error:', err);
    res.status(500).json({
      success: false,
      error: { code: 'DB_ERROR', message: err.message }
    });
  }
};

/**
 * GET /api/alerts — role-scoped
 */
exports.getAlerts = async (req, res) => {
  try {
    const { camera_id, type, from, to, limit = 50, page = 1, status, severity } = req.query;

    const siteFilter = await getSiteFilter(req.user);
    const filter = { ...siteFilter };
    const SEVERITY_TYPE_MAP = {
      Critical: ['restricted_zone', 'machinery_proximity', 'predicted_machinery_collision', 'fall_no_movement'],
      Warning: ['helmet_missing', 'vest_missing', 'no_movement', 'proximity_ppe_violation'],
      Info: ['predicted_zone_entry'],
    };

    if (camera_id) filter.camera_id = camera_id;
    if (status) filter.status = status;
    // If a specific type is given, use it directly; otherwise check severity
    if (type) {
      filter.type = type;
    } else if (severity && SEVERITY_TYPE_MAP[severity]) {
      filter.type = { $in: SEVERITY_TYPE_MAP[severity] };
    }
    if (from || to) {
      filter.timestamp = {};
      if (from) filter.timestamp.$gte = new Date(from);
      if (to) filter.timestamp.$lte = new Date(to);
    }

    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const skip = (parsedPage - 1) * parsedLimit;

    const [alerts, total] = await Promise.all([
      Alert.find(filter).sort({ timestamp: -1 }).skip(skip).limit(parsedLimit).lean(),
      Alert.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: alerts,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        pages: Math.ceil(total / parsedLimit)
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'DB_ERROR', message: err.message }
    });
  }
};

/**
 * PUT /api/alerts/:alert_id/resolve — resolve an alert
 */
exports.resolveAlert = async (req, res) => {
  try {
    const { alert_id } = req.params;
    const { status } = req.body;

    if (!status || !['acknowledged', 'resolved'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'status must be "acknowledged" or "resolved"' }
      });
    }

    const alert = await Alert.findOne({ alert_id });
    if (!alert) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Alert not found' }
      });
    }

    // Site access check
    const hasAccess = await hasSiteAccess(req.user, alert.site_id);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'No access to this alert' }
      });
    }

    alert.status = status;
    if (status === 'resolved') {
      alert.resolvedBy = req.user ? req.user.email : 'system';
      alert.resolvedAt = new Date();
    }

    await alert.save();

    res.json({ success: true, data: alert });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'DB_ERROR', message: err.message }
    });
  }
};

exports.deleteAlert = async (req, res) => {
  try {
    const { alert_id } = req.params;
    const alert = await Alert.findOne({ alert_id });
    if (!alert) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Alert not found' }
      });
    }

    // Site access check
    const hasAccess = await hasSiteAccess(req.user, alert.site_id);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'No access to this alert' }
      });
    }

    deleteSnapshotFile(alert.snapshot_url);
    await Alert.deleteOne({ alert_id });
    res.json({ success: true, message: 'Alert deleted' });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'DB_ERROR', message: err.message }
    });
  }
};

exports.clearAlerts = async (req, res) => {
  try {
    const siteFilter = await getSiteFilter(req.user);
    const filter = { ...siteFilter };
    if (req.query.camera_id) filter.camera_id = req.query.camera_id;

    const alerts = await Alert.find(filter).select('snapshot_url').lean();
    for (const a of alerts) deleteSnapshotFile(a.snapshot_url);
    const result = await Alert.deleteMany(filter);
    res.json({ success: true, data: { deleted: result.deletedCount } });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'DB_ERROR', message: err.message }
    });
  }
};
