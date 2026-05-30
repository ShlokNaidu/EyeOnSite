const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  alert_id: { type: String, required: true, unique: true },
  camera_id: { type: String, required: true, ref: 'Camera' },
  camera_name: { type: String, default: '' },
  site_id: { type: String, ref: 'Site', default: '' },
  type: {
    type: String,
    enum: [
      'helmet_missing',
      'vest_missing',
      'restricted_zone',
      'machinery_proximity',
      'predicted_machinery_collision',
      'predicted_zone_entry',
      'no_movement'
    ],
    required: true
  },
  timestamp: { type: Date, required: true },
  snapshot_url: { type: String },
  metadata: { type: Object },
  status: { type: String, enum: ['pending', 'acknowledged', 'resolved'], default: 'pending' },
  resolvedBy: { type: String, default: null },
  resolvedAt: { type: Date, default: null }
});

alertSchema.index({ camera_id: 1, timestamp: -1 });
alertSchema.index({ type: 1, timestamp: -1 });
alertSchema.index({ site_id: 1, timestamp: -1 });

module.exports = mongoose.model('Alert', alertSchema);
