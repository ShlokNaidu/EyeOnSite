const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const ALLOWED_EXTENSIONS = ['.mp4', '.avi', '.mov'];
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Sanitize filename to prevent path traversal
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const uniqueName = `${Date.now()}_${sanitized}`;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(new Error(`File type not allowed. Accepted: ${ALLOWED_EXTENSIONS.join(', ')}`));
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE }
});

exports.uploadMiddleware = upload.single('video_file');

exports.uploadVideo = (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: { code: 'FILE_UPLOAD_ERROR', message: 'No video file provided' }
    });
  }

  const relativePath = `uploads/${req.file.filename}`;

  res.json({
    success: true,
    data: {
      source_path: relativePath,
      size_bytes: req.file.size
    }
  });
};
