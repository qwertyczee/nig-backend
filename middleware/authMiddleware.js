const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

if (!SUPABASE_JWT_SECRET) {
  console.warn(
    'Warning: SUPABASE_JWT_SECRET is not set in the .env file. Authentication middleware will not function correctly for actual Supabase JWTs.'
  );
}

/**
 * Middleware to protect routes by verifying a JWT from the authorization header.
 * If SUPABASE_JWT_SECRET is not set, it uses a mock user for development purposes.
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 * @param {function} next - The next middleware function.
 */
const protect = (req, res, next) => {
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      token = req.headers.authorization.split(' ')[1];

      if (!SUPABASE_JWT_SECRET) {
        console.warn('SUPABASE_JWT_SECRET not set. Using mock user for protected route.');
        req.user = { id: 'mock-user-id-from-middleware', role: 'user' };
        return next();
      }
      
      const decoded = jwt.verify(token, SUPABASE_JWT_SECRET);

      req.user = {
        id: decoded.sub,
        role: decoded.user_role || (decoded.claims_admin ? 'admin' : 'user'),
        aud: decoded.aud,
        iat: decoded.iat,
        exp: decoded.exp,
      };

      next();
    } catch (error) {
      console.error('Token verification failed:', error);
      res.status(401).json({ message: 'Not authorized, token failed' });
    }
  }

  if (!token) {
    res.status(401).json({ message: 'Not authorized, no token' });
  }
};

/**
 * Middleware to restrict access to admin users.
 * Checks if the authenticated user has 'admin' or 'service_role' role.
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 * @param {function} next - The next middleware function.
 */
const admin = (req, res, next) => {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'service_role')) {
    next();
  } else {
    res.status(403).json({ message: 'Not authorized as an admin' });
  }
};

module.exports = {
    protect,
    admin
};