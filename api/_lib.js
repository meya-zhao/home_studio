const jwt = require('jsonwebtoken');

function requireAuth(req, res) {
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  try {
    return jwt.verify(auth.slice(7), process.env.JWT_SECRET);
  } catch {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
}

module.exports = { requireAuth };
