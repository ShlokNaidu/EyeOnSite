const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Site = require('../models/Site');

const JWT_SECRET = process.env.JWT_SECRET || 'eyeonsite_jwt_secret_change_in_production';
const JWT_EXPIRES_IN = '7d';

function generateToken(user) {
  return jwt.sign(
    {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      siteId: user.site_id || null
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/**
 * POST /api/auth/register
 * Public registration — creates a new Site + site_officer User.
 */
exports.register = async (req, res) => {
  try {
    const { siteName, fullName, email, password } = req.body;

    if (!siteName || !fullName || !email || !password) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'siteName, fullName, email, and password are required' }
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Password must be at least 6 characters' }
      });
    }

    // Check duplicate email
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({
        success: false,
        error: { code: 'CONFLICT', message: 'Email already registered' }
      });
    }

    // Create site
    const site = await Site.create({ name: siteName });

    // Create user as site_officer — if this fails, clean up the site
    let user;
    try {
      user = await User.create({
        email,
        password,
        fullName,
        role: 'site_officer',
        site_id: site.site_id
      });
    } catch (userErr) {
      // Rollback: delete the orphaned site
      await Site.deleteOne({ _id: site._id });
      if (userErr.code === 11000) {
        return res.status(409).json({
          success: false,
          error: { code: 'CONFLICT', message: 'Email already registered' }
        });
      }
      throw userErr;
    }

    const token = generateToken(user);

    res.status(201).json({
      success: true,
      data: {
        token,
        user: {
          id: user._id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          siteId: user.site_id,
          siteName: site.name
        }
      }
    });
  } catch (err) {
    console.error('[Auth] Register error:', err);
    res.status(500).json({
      success: false,
      error: { code: 'DB_ERROR', message: err.message }
    });
  }
};

/**
 * POST /api/auth/login
 */
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Email and password are required' }
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' }
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' }
      });
    }

    // Get site name if user has a site
    let siteName = null;
    if (user.site_id) {
      const site = await Site.findOne({ site_id: user.site_id });
      if (site) siteName = site.name;
    }

    const token = generateToken(user);

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user._id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          siteId: user.site_id,
          siteName,
          createdBy: user.createdBy
        }
      }
    });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    res.status(500).json({
      success: false,
      error: { code: 'DB_ERROR', message: err.message }
    });
  }
};

/**
 * GET /api/auth/me — requires authMiddleware
 */
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).lean();
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'User not found' }
      });
    }

    let siteName = null;
    if (user.site_id) {
      const site = await Site.findOne({ site_id: user.site_id });
      if (site) siteName = site.name;
    }

    res.json({
      success: true,
      data: {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        siteId: user.site_id,
        siteName,
        createdBy: user.createdBy
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'DB_ERROR', message: err.message }
    });
  }
};
