/**
 * Middleware to extract and require userId from request
 * Reads from X-User-Id header or ?userId query parameter
 */

function requireUserId(req, res, next) {
  const userId = req.headers['x-user-id'] || req.query.userId;
  
  if (!userId) {
    return res.status(400).json({
      ok: false,
      error: 'user_id_required',
      message: 'userId required in X-User-Id header or query parameter',
    });
  }
  
  // Attach userId to request object for easy access
  req.userId = userId;
  next();
}

module.exports = requireUserId;

