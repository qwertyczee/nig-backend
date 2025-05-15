const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const session = require('express-session');
const serverless = require('serverless-http'); // ← import serverless-http

// Import routes
const productRoutes = require('./routes/productRoutes.js');
const orderRoutes = require('./routes/orderRoutes.js');
const webhookRoutes = require('./routes/webhookRoutes.js');
const adminRoutes = require('./routes/adminRoutes.js');
// initDb is no longer called here to prevent blocking cold starts.
// const { initDb } = require('./config/db.js'); // supabase client is still imported by controllers directly

console.log('LOG: index.ts: Top-level script execution start. NODE_ENV:', process.env.NODE_ENV);

// Load .env (only for local development—Vercel injects env vars in prod)
dotenv.config({ path: path.resolve(__dirname, '../.env') });
console.log('LOG: index.ts: dotenv.config executed.');
console.log('LOG: index.ts: SUPABASE_URL loaded:', !!process.env.SUPABASE_URL);
console.log('LOG: index.ts: SESSION_SECRET loaded:', !!process.env.SESSION_SECRET);
console.log('LOG: index.ts: VERCEL_URL (from Vercel):', process.env.VERCEL_URL);


const app = express();
const SESSION_SECRET = process.env.SESSION_SECRET || 'fallback-secret-if-not-set-in-env';
console.log('LOG: index.ts: Express app initialized.');

// Logging middleware - VERY FIRST middleware in the chain
app.use((req, res, next) => {
  console.log(`LOG: index.ts: REQUEST RECEIVED: ${req.method} ${req.originalUrl} (req.path: ${req.path})`);
  console.log('LOG: index.ts: Request Headers:', JSON.stringify(req.headers, null, 2));
  // Log session details if available
  if (req.session) {
    console.log('LOG: index.ts: Request Session ID:', req.sessionID);
    console.log('LOG: index.ts: Request Session Data:', JSON.stringify(req.session, null, 2));
  } else {
    console.log('LOG: index.ts: No session attached to request yet.');
  }
  next();
});

// Basic middleware
app.use(express.urlencoded({ extended: true }));
console.log('LOG: index.ts: express.urlencoded middleware added.');

// Special raw body parser for specific webhook route
// IMPORTANT: This must come BEFORE global express.json() if it's for a sub-path of /api
// and other /api paths need express.json(). Order matters.
app.use('/api/webhooks/polar', express.raw({ type: 'application/json' }));
console.log('LOG: index.ts: express.raw for /api/webhooks/polar added.');

app.use(express.json());
console.log('LOG: index.ts: express.json middleware added.');

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: true, // Set to false if you don't want sessions for unauthenticated users
  cookie: { 
    secure: process.env.NODE_ENV === 'production', // Should be true in production (Vercel)
    httpOnly: true, 
    maxAge: 86400000, // 1 day
    sameSite: 'lax' // Recommended for CSRF protection
  }
}));
console.log('LOG: index.ts: express-session middleware added. Secure cookie:', process.env.NODE_ENV === 'production');

// Initialize DB - Removed initDb() call to prevent blocking cold starts.
// The Supabase client is initialized in db.js and used directly by controllers.
console.log('LOG: index.ts: Supabase client is initialized in db.js and will be used by controllers.');

// Health check
app.get('/api', (req, res) => {
  console.log('LOG: index.ts: /api health check route hit.');
  res.status(200).send('E-shop API is running! Health check successful. Timestamp: ' + new Date().toISOString());
});
console.log('LOG: index.ts: /api health check route defined.');

// Mount routes
app.use('/api/products', productRoutes);
console.log('LOG: index.ts: /api/products routes mounted.');
app.use('/api/orders', orderRoutes);
console.log('LOG: index.ts: /api/orders routes mounted.');
app.use('/api/webhooks', webhookRoutes);
console.log('LOG: index.ts: /api/webhooks routes mounted.');
app.use('/admin', adminRoutes); // Note: This is not under /api
console.log('LOG: index.ts: /admin routes mounted.');

// Catch-all for 404s originating from Express (if no routes matched)
// This should be placed AFTER all your route definitions
app.use((req, res, next) => {
  console.log(`LOG: index.ts: EXPRESS 404: No route matched for ${req.method} ${req.originalUrl}`);
  res.status(404).send(`Express server couldn't find the route: ${req.method} ${req.originalUrl}`);
});

// Global Error handler - This should be the LAST middleware
app.use((err, req, res, next) => {
  console.error('LOG: index.ts: GLOBAL ERROR HANDLER CAUGHT ERROR:');
  console.error('LOG: index.ts: Error Message:', err.message);
  console.error('LOG: index.ts: Error Stack:', err.stack);
  // Avoid sending stack trace in production for security reasons
  if (process.env.NODE_ENV === 'production') {
    res.status(500).send('Internal Server Error');
  } else {
    res.status(500).send(`Something broke! ${err.message}`);
  }
});
console.log('LOG: index.ts: Global error handler added.');

console.log('LOG: index.ts: Preparing to export handler with serverless(app).');


const vercelHandler = serverless(app);
module.exports = vercelHandler;

console.log('LOG: index.ts: Handler (default export) prepared successfully.');