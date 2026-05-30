const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const siteSchema = new mongoose.Schema({
  site_id: { type: String, required: true, unique: true, default: () => `site_${uuidv4().slice(0, 8)}` },
  name: { type: String, required: true },
  address: { type: String, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Site', siteSchema);
