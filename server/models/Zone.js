const mongoose = require('mongoose');

const zoneSchema = new mongoose.Schema({
  zone_id: { type: String, required: true, unique: true },
  name: { type: String, required: false },
  camera_id: { type: String, required: true, ref: 'Camera' },
  zone_type: { type: String, enum: ['restricted', 'proximity', 'safe'], required: true },
  coordinates: {
    type: [Number],
    required: true,
    validate: {
      validator: v => v.length >= 6 && v.length % 2 === 0,
      message: 'coordinates must be an array of length >= 6 (at least 3 points) and even'
    }
  },
  rules: {
    helmet_required: { type: Boolean, default: true },
    vest_required: { type: Boolean, default: true }
  },
  updated_at: { type: Date, default: Date.now }
});

zoneSchema.index({ camera_id: 1, zone_type: 1 });

module.exports = mongoose.model('Zone', zoneSchema);
