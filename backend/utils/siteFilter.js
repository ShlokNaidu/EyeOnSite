const User = require('../models/User');
const Site = require('../models/Site');

const SUPER_ADMIN_EMAIL = 'admin@eyeonsite.com';

/**
 * Returns a MongoDB query filter object based on the user's role and hierarchy:
 * - Site Officer: sees only their assigned site
 * - SuperAdmin (no createdBy): sees all sites (returns empty filter {})
 * - Regular Admin: sees only sites they created
 * 
 * @param {Object} user - from req.user (requires userId and role)
 * @returns {Promise<Object>} MongoDB filter object
 */
async function getSiteFilter(user) {
  if (!user) return {};
  
  if (user.role !== 'admin') {
    return { site_id: user.siteId || '' };
  }

  // Admin logic
  const adminUser = await User.findById(user.userId);
  if (!adminUser || adminUser.email === SUPER_ADMIN_EMAIL) {
    // SuperAdmin
    return {};
  }

  // Regular Admin
  const sites = await Site.find({ createdBy: user.userId }).select('site_id').lean();
  const siteIds = sites.map(s => s.site_id);
  return { site_id: { $in: siteIds } };
}

/**
 * Checks if a user has permission to access a specific site
 * @param {Object} user - from req.user
 * @param {String} targetSiteId - the site_id to check
 * @returns {Promise<Boolean>}
 */
async function hasSiteAccess(user, targetSiteId) {
  if (!user) return false;

  if (user.role !== 'admin') {
    return user.siteId === targetSiteId;
  }

  // Admin logic
  const adminUser = await User.findById(user.userId);
  if (!adminUser || adminUser.email === SUPER_ADMIN_EMAIL) {
    return true; // SuperAdmin
  }

  const site = await Site.findOne({ site_id: targetSiteId });
  if (!site) return false;

  return site.createdBy?.toString() === user.userId;
}

module.exports = {
  getSiteFilter,
  hasSiteAccess
};
