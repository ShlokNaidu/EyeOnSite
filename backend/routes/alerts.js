const express = require('express');
const router = express.Router();
const alertController = require('../controllers/alertController');
const internalAuth = require('../middleware/internalAuth');
const authMiddleware = require('../middleware/authMiddleware');

// Internal: receive alert from Python AI service (NO JWT — uses internal key)
router.post('/', internalAuth, alertController.receiveAlert);

// Protected: frontend routes (require JWT)
router.get('/', authMiddleware, alertController.getAlerts);
router.put('/:alert_id/resolve', authMiddleware, alertController.resolveAlert);
router.delete('/:alert_id', authMiddleware, alertController.deleteAlert);
router.delete('/', authMiddleware, alertController.clearAlerts);

module.exports = router;
