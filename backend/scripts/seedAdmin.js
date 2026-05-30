/**
 * Seed script: Create the first admin user.
 *
 * Usage:
 *   node scripts/seedAdmin.js
 *
 * This creates an admin user with:
 *   Email:    admin@eyeonsite.com
 *   Password: admin123
 *
 * You can change these below or pass env vars:
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/seedAdmin.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const mongoose = require('mongoose');
const User = require('../models/User');
const Site = require('../models/Site');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/construction_safety';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@eyeonsite.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_NAME = process.env.ADMIN_NAME || 'System Admin';

async function seed() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('[Seed] Connected to MongoDB');

    // Check if admin already exists
    const existing = await User.findOne({ email: ADMIN_EMAIL.toLowerCase() });
    if (existing) {
      console.log(`[Seed] Admin user already exists: ${ADMIN_EMAIL}`);
      console.log(`[Seed] Role: ${existing.role}`);
      process.exit(0);
    }

    // Create a default admin site (optional, admin doesn't strictly need one)
    let adminSite = await Site.findOne({ name: 'Admin HQ' });
    if (!adminSite) {
      adminSite = await Site.create({ name: 'Admin HQ', address: 'Headquarters' });
      console.log(`[Seed] Created admin site: ${adminSite.site_id}`);
    }

    // Create admin user
    const admin = await User.create({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      fullName: ADMIN_NAME,
      role: 'admin',
      site_id: adminSite.site_id
    });

    console.log('[Seed] ✅ Admin user created successfully!');
    console.log(`  Email:    ${admin.email}`);
    console.log(`  Password: ${ADMIN_PASSWORD}`);
    console.log(`  Role:     ${admin.role}`);
    console.log(`  Site:     ${adminSite.name} (${adminSite.site_id})`);
    console.log('');
    console.log('[Seed] You can now login with these credentials.');

    process.exit(0);
  } catch (err) {
    console.error('[Seed] Error:', err.message);
    process.exit(1);
  }
}

seed();
