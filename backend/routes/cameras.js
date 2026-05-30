const express = require('express');
const router = express.Router();
const cameraController = require('../controllers/cameraController');
const authMiddleware = require('../middleware/authMiddleware');

router.post('/', authMiddleware, cameraController.createCamera);
router.get('/', authMiddleware, cameraController.getAllCameras);
router.post('/:camera_id/activate', authMiddleware, cameraController.activateCamera);
router.post('/:camera_id/pause', authMiddleware, cameraController.pauseCamera);
router.get('/:camera_id/status', authMiddleware, cameraController.cameraStatus);
router.put('/:camera_id', authMiddleware, cameraController.updateCamera);
router.delete('/:camera_id', authMiddleware, cameraController.deleteCamera);

module.exports = router;
