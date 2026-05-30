const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

// All admin routes require auth + admin role
router.use(authMiddleware);
router.use(requireRole('admin'));

// Sites
router.get('/sites', adminController.getAllSites);
router.post('/sites', adminController.createSite);
router.delete('/sites/:site_id', adminController.deleteSite);

// Users
router.get('/users', adminController.getAllUsers);
router.post('/users', adminController.createUser);
router.put('/users/:userId', adminController.updateUser);
router.delete('/users/:userId', adminController.deleteUser);

module.exports = router;
