const express = require('express');
const router = express.Router();
const { uploadMiddleware, uploadVideo } = require('../controllers/uploadController');

router.post('/', uploadMiddleware, uploadVideo);

module.exports = router;
