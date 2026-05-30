require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const { setupWebSocket } = require('./websocket');

const app = express();
const server = http.createServer(app);
require("node:dns/promises").setServers(["1.1.1.1", "8.8.8.8"]);
// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());

// Static files: snapshots and uploads
app.use('/snapshots', express.static(path.join(__dirname, 'snapshots')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Ensure directories exist
const fs = require('fs');
['snapshots', 'uploads'].forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/cameras', require('./routes/cameras'));
app.use('/api/zones', require('./routes/zones'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api/stats', require('./routes/stats'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/sites', require('./routes/sites'));

// Health endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    }
  });
});

// Error handling for multer
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      success: false,
      error: { code: 'FILE_UPLOAD_ERROR', message: 'File too large. Max 500MB.' }
    });
  }
  if (err.message && err.message.includes('File type not allowed')) {
    return res.status(400).json({
      success: false,
      error: { code: 'FILE_UPLOAD_ERROR', message: err.message }
    });
  }
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: { code: 'DB_ERROR', message: 'Internal server error' }
  });
});

// WebSocket
setupWebSocket(server);

// Connect MongoDB and start server
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/construction_safety';

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('[DB] Connected to MongoDB');
    server.listen(PORT, () => {
      console.log(`[Server] Running on port ${PORT}`);
      console.log(`[Server] WebSocket ready on ws://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('[DB] MongoDB connection failed:', err.message);
    process.exit(1);
  });
