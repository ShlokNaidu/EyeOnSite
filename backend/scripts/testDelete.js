const mongoose = require('mongoose');
const Site = require('../models/Site');
const User = require('../models/User');

async function testDelete() {
  await mongoose.connect('mongodb+srv://shlok16naidu_db_user:shlok1609@cluster0.clevwgb.mongodb.net/construction_safety?retryWrites=true&w=majority&appName=Cluster0');
  
  const adminId = '67d4f9b88cf1815b81a742c3'; // admin@eyeonsite.com
  const siteIdToDelete = 'site-local';

  console.log("Looking up admin user...");
  const adminUser = await User.findById(adminId);
  console.log("AdminUser:", adminUser ? adminUser.email : 'not found');
  
  let filter = { site_id: siteIdToDelete };
  if (adminUser && adminUser.createdBy) {
    console.log("Admin has createdBy, adding filter.");
    filter.createdBy = adminId;
  }
  
  console.log("Executing delete with filter:", filter);
  const site = await Site.findOneAndDelete(filter);
  
  if (!site) {
    console.log("Site not found or permission denied.");
  } else {
    console.log("Site deleted successfully:", site);
  }
  
  mongoose.disconnect();
}

testDelete().catch(console.error);
