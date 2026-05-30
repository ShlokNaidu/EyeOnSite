const express = require('express');
const router = express.Router();
const Site = require('../models/Site');
const User = require('../models/User');
const authMiddleware = require('../middleware/authMiddleware');

const SUPER_ADMIN_EMAIL = 'admin@eyeonsite.com';

/**
 * GET /api/sites/my — returns sites accessible to the current user
 * - Site officer: returns their single assigned site
 * - Admin: returns sites they created
 * - SuperAdmin: returns all sites
 */
router.get('/my', authMiddleware, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      // Admin or Super Admin
      const adminUser = await User.findById(req.user.userId);
      if (!adminUser || adminUser.email === SUPER_ADMIN_EMAIL) {
        // SuperAdmin: all sites
        const sites = await Site.find().lean();
        return res.json({ success: true, data: sites });
      }
      // Regular admin: sites they created
      const sites = await Site.find({ createdBy: req.user.userId }).lean();
      return res.json({ success: true, data: sites });
    }

    // Site officer: look up their single assigned site
    const siteId = req.user.siteId;
    if (!siteId) return res.json({ success: true, data: [] });
    const site = await Site.findOne({ site_id: siteId }).lean();
    return res.json({ success: true, data: site ? [site] : [] });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: err.message } });
  }
});

module.exports = router;
