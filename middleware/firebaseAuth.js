const admin = require('../firebaseAdmin');

const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }

  const idToken = authHeader.split(' ')[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken; // Contains uid, email, etc.
    next();
  } catch (error) {
    console.error('Token verification failed:', error);
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

// Role-based middleware (use after authenticate)
const requireHR = (req, res, next) => {
  if (!req.user.role || req.user.role !== 'HR') {
    return res.status(403).json({ success: false, message: 'HR access required' });
  }
  next();
};

const requireEmployee = (req, res, next) => {
  if (!req.user.role || req.user.role !== 'EMPLOYEE') {
    return res.status(403).json({ success: false, message: 'Employee access required' });
  }
  next();
};

module.exports = { authenticate, requireHR, requireEmployee };