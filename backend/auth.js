const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'shs-local-dev-secret';

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      form_level: user.form_level
    },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication token required' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session token' });
  }
}

function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied for your user role' });
    }
    next();
  };
}

module.exports = { signToken, authenticate, authorizeRoles };