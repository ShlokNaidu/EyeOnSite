const express = require('express');
const router = express.Router();
const zoneController = require('../controllers/zoneController');
const authMiddleware = require('../middleware/authMiddleware');

router.post('/', authMiddleware, zoneController.createZone);
router.get('/:camera_id', authMiddleware, zoneController.getZonesForCamera);
router.delete('/:zone_id', authMiddleware, zoneController.deleteZone);

module.exports = router;
