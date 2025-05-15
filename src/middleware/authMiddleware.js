const { Request, Response, NextFunction } = require('express');
const jwt = require('jsonwebtoken'); // Using jsonwebtoken for standard JWT operations
const dotenv = require('dotenv');
const path = require('path');

// Load .env from backend directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

if (!SUPABASE_JWT_SECRET) {
  console.warn(
    'Warning: SUPABASE_JWT_SECRET is not set in the .env file. Authentication middleware will not function correctly for actual Supabase JWTs.'
  );
  // In a real scenario, you might throw an error or use a default insecure secret for local dev only.
  // For this placeholder, we'll allow it to proceed but log a warning.
}

const protect = (req, res, next) => {
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      token = req.headers.authorization.split(' ')[1];

      if (!SUPABASE_JWT_SECRET) {
        // Fallback for when SUPABASE_JWT_SECRET is not set (e.g. local dev without full Supabase setup)
        // This is a MOCK verification for placeholder purposes.
        console.warn('SUPABASE_JWT_SECRET not set. Using mock user for protected route.');
        req.user = { id: 'mock-user-id-from-middleware', role: 'user' }; // Mock user
        return next();
      }
      
      // Verify token using Supabase JWT secret
      const decoded = jwt.verify(token, SUPABASE_JWT_SECRET);

      // Attach user to request object
      // Supabase JWT payload typically includes 'sub' (user ID) and 'role' (authenticated, anon, etc.)
      // You might have custom claims like a specific admin role.
      req.user = {
        id: decoded.sub,
        role: decoded.user_role || (decoded.claims_admin ? 'admin' : 'user'), // Example: check for custom admin claim
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

const admin = (req, res, next) => {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'service_role')) { // service_role is Supabase's super admin
    next();
  } else {
    res.status(403).json({ message: 'Not authorized as an admin' });
  }
};

module.exports = {
    protect,
    admin
};