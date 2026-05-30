/**
 * Reset admin password with proper bcrypt hashing.
 * Usage: node scripts/fixAdmin.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const mongoose = require('mongoose');
const User = require('../models/User');
const Site = require('../models/Site');

async function fix() {
  await mongoose.connect(process.env.MONGO_URI);

  // Delete old admin and re-create with proper hashing
  await User.deleteOne({ email: 'admin@eyeonsite.com' });
  console.log('[Fix] Deleted old admin user');

  // Ensure admin site exists
  let site = await Site.findOne({ name: 'Admin HQ' });
  if (!site) {
    site = await Site.create({ name: 'Admin HQ', address: 'Headquarters' });
    console.log('[Fix] Created Admin HQ site:', site.site_id);
  }

  // Create fresh admin — User model pre-save hook will bcrypt the password
  const admin = await User.create({
    email: 'admin@eyeonsite.com',
    password: 'admin123',
    fullName: 'System Admin',
    role: 'admin',
    site_id: site.site_id
  });

  console.log('✅ Admin re-created with hashed password!');
  console.log('   Email:    admin@eyeonsite.com');
  console.log('   Password: admin123');
  console.log('   Role:     admin');
  process.exit(0);
}
fix();
