const User = require('../models/User');
const Site = require('../models/Site');
const Camera = require('../models/Camera');
const Zone = require('../models/Zone');
const Alert = require('../models/Alert');
const { requireRole } = require('../middleware/roleMiddleware');

const SUPER_ADMIN_EMAIL = 'admin@eyeonsite.com';

/**
 * GET /api/admin/sites — list all sites
 */
exports.getAllSites = async (req, res) => {
  try {
    const adminUser = await User.findById(req.user.userId);
    let filter = {};
    if (adminUser.email !== SUPER_ADMIN_EMAIL) {
      // Regular admin: only see sites they created
      filter.createdBy = req.user.userId;
    }
    const sites = await Site.find(filter).lean();
    res.json({ success: true, data: sites });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: err.message } });
  }
};

/**
 * POST /api/admin/sites — create a new site
 */
exports.createSite = async (req, res) => {
  try {
    const { name, address } = req.body;
    if (!name) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Site name is required' }
      });
    }
    const site = await Site.create({ 
      name, 
      address: address || '',
      createdBy: req.user.userId
    });
    res.status(201).json({ success: true, data: site });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: err.message } });
  }
};

/**
 * DELETE /api/admin/sites/:site_id
 */
exports.deleteSite = async (req, res) => {
  try {
    const { site_id } = req.params;
    const adminUser = await User.findById(req.user.userId);
    
    let filter = { site_id };
    if (adminUser.email !== SUPER_ADMIN_EMAIL) {
      filter.createdBy = req.user.userId;
    }

    const site = await Site.findOneAndDelete(filter);
    if (!site) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Site not found or you do not have permission to delete it' }
      });
    }

    // Cascading deletes
    try {
      const cameras = await Camera.find({ site_id: site.site_id }).lean();
      const cameraIds = cameras.map(c => c.camera_id);
      
      if (cameraIds.length > 0) {
        await Zone.deleteMany({ camera_id: { $in: cameraIds } });
        await Camera.deleteMany({ site_id: site.site_id });
      }
      await Alert.deleteMany({ site_id: site.site_id });
      await User.deleteMany({ site_id: site.site_id, role: 'site_officer' });
    } catch (cleanupErr) {
      console.error('[Admin] Cleanup error after site deletion:', cleanupErr);
    }

    res.json({ success: true, message: 'Site deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: err.message } });
  }
};

/**
 * GET /api/admin/users — list all users (no passwords)
 */
exports.getAllUsers = async (req, res) => {
  try {
    const adminUser = await User.findById(req.user.userId);
    let filter = {};
    if (adminUser.email !== SUPER_ADMIN_EMAIL) {
      filter.createdBy = req.user.userId;
    }

    const users = await User.find(filter).select('-password').lean();
    
    // Enrich with site names
    const sites = await Site.find().lean();
    const siteMap = {};
    sites.forEach(s => { siteMap[s.site_id] = s.name; });

    const enriched = users.map(u => ({
      ...u,
      siteName: u.site_id ? siteMap[u.site_id] || 'Unknown' : null
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: err.message } });
  }
};

/**
 * POST /api/admin/users — Admin creates a site_officer account
 */
exports.createUser = async (req, res) => {
  try {
    const { email, password, fullName, role, site_id } = req.body;

    if (!email || !password || !fullName) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'email, password, and fullName are required' }
      });
    }

    const assignedRole = role || 'site_officer';
    if (assignedRole === 'site_officer' && !site_id) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'site_id is required for site_officer role' }
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Password must be at least 6 characters' }
      });
    }

    const adminUser = await User.findById(req.user.userId);

    // Guard: Only SuperAdmin can create an admin
    if (assignedRole === 'admin' && adminUser.email !== SUPER_ADMIN_EMAIL) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Only Super Admin can create other admins' }
      });
    }

    let site = null;
    // Verify site exists if provided
    if (site_id) {
      site = await Site.findOne({ site_id });
      if (!site) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Site not found' }
        });
      }
      
      if (adminUser.email !== SUPER_ADMIN_EMAIL && site.createdBy?.toString() !== req.user.userId) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You can only assign users to sites you created' }
        });
      }
    }

    // Check duplicate email
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({
        success: false,
        error: { code: 'CONFLICT', message: 'Email already registered' }
      });
    }

    const user = await User.create({
      email,
      password,
      fullName,
      role: assignedRole,
      site_id: site_id || null,
      createdBy: req.user.userId
    });

    res.status(201).json({
      success: true,
      data: {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        siteId: user.site_id,
        siteName: site ? site.name : null
      }
    });
  } catch (err) {
    console.error('[Admin] Create user error:', err);
    res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: err.message } });
  }
};

/**
 * PUT /api/admin/users/:userId — update role or site assignment
 */
exports.updateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { role, site_id } = req.body;

    const adminUser = await User.findById(req.user.userId);
    let filter = { _id: userId };
    if (adminUser.email !== SUPER_ADMIN_EMAIL) {
      filter.createdBy = req.user.userId;
    }

    const user = await User.findOne(filter);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'User not found or you do not have permission to edit them' }
      });
    }

    if (role && ['admin', 'site_officer'].includes(role)) {
      if (role === 'admin' && adminUser.email !== SUPER_ADMIN_EMAIL) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Only Super Admin can assign the admin role' }
        });
      }
      user.role = role;
    }
    if (site_id !== undefined) {
      if (site_id) {
         const site = await Site.findOne({ site_id });
         if (!site || (adminUser.email !== SUPER_ADMIN_EMAIL && site.createdBy?.toString() !== req.user.userId)) {
             return res.status(403).json({
                 success: false,
                 error: { code: 'FORBIDDEN', message: 'Site not found or access denied' }
             });
         }
      }
      user.site_id = site_id || null;
    }

    await user.save();

    res.json({
      success: true,
      data: {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        siteId: user.site_id
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: err.message } });
  }
};

/**
 * DELETE /api/admin/users/:userId
 */
exports.deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;

    // Prevent self-deletion
    if (req.user.userId === userId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Cannot delete your own account' }
      });
    }

    const adminUser = await User.findById(req.user.userId);
    let filter = { _id: userId };
    if (adminUser.email !== SUPER_ADMIN_EMAIL) {
      filter.createdBy = req.user.userId;
    }

    const user = await User.findOneAndDelete(filter);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'User not found or you do not have permission to delete them' }
      });
    }

    res.json({ success: true, message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: err.message } });
  }
};
