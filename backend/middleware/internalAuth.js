const crypto = require('crypto');

function internalAuth(req, res, next) {
  const key = req.headers['x-internal-key'];
  const expected = process.env.INTERNAL_API_KEY;

  if (!key || !expected) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED_INTERNAL', message: 'Missing internal API key' }
    });
  }

  // Constant-time comparison to prevent timing attacks
  const keyBuf = Buffer.from(key);
  const expectedBuf = Buffer.from(expected);

  if (keyBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(keyBuf, expectedBuf)) {
    console.warn(`[AUTH] Rejected internal request from ${req.ip}`);
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED_INTERNAL', message: 'Invalid internal API key' }
    });
  }

  next();
}

module.exports = internalAuth;
