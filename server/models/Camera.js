const mongoose = require('mongoose');

const cameraSchema = new mongoose.Schema({
  camera_id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  source_type: { type: String, enum: ['live', 'rtsp', 'video'], required: true },
  source_path: { type: String, required: true },
  site_id: { type: String, ref: 'Site', default: '' },
  is_active: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now }
});

cameraSchema.index({ is_active: 1 });
cameraSchema.index({ site_id: 1 });

module.exports = mongoose.model('Camera', cameraSchema);
