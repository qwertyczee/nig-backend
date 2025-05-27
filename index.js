const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');

// Import Supabase client (not initDb)
const { supabase } = require('./config/db.js');

// Import routes
const productRoutes = require('./routes/productRoutes.js');
const orderRoutes = require('./routes/orderRoutes.js');
const webhookRoutes = require('./routes/webhookRoutes.js');
const adminRoutes = require('./routes/adminRoutes.js');

// Load .env
dotenv.config();
console.log('LOG: index.js: dotenv.config executed.');
console.log('LOG: index.js: SUPABASE_URL loaded:', !!process.env.SUPABASE_URL);
console.log('LOG: index.js: SESSION_SECRET loaded:', !!process.env.SESSION_SECRET);

// --- Unhandled Rejection & Uncaught Exception Handlers ---
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // In a real app, use a proper logger: logger.error(...)
});
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // In a real app, use a proper logger: logger.error(...)
});

const PORT = process.env.PORT || 3001; // Changed default from 8080 to 3001 as 8080 is common for frontend dev
const app = express();

// Set EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views')); // Specify the views directory

app.set('trust proxy', 1); // Important if behind a proxy like Vercel

// --- Parsers ---
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// --- CORS Configuration ---
// Using a simpler CORS setup for now, can be expanded like the example if needed.
// The example's whitelist approach is good for production.
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const whitelist = [FRONTEND_URL, 'http://localhost:3000', 'http://localhost:3001', 'https://www.slavesonline.store', 'http://www.slavesonline.store', 'https://slavesonline.store', 'http://slavesonline.store', 'https://api.slavesonline.store']; // Added common Vite dev port
if (process.env.VERCEL_URL) {
    whitelist.push(`https://${process.env.VERCEL_URL}`);
}


const corsOptions = {
    credentials: true,
    methods: ['GET','POST','PUT','DELETE','PATCH','OPTIONS'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Accept',
        'Origin',
        'X-Requested-With'
    ],
    maxAge: 86400, // 1 day
    origin: (incomingOrigin, callback) => {
        console.log('[CORS] incoming origin:', incomingOrigin);
        if (!incomingOrigin || whitelist.includes(incomingOrigin)) {
            return callback(null, true);
        }
        const msg = `Origin ${incomingOrigin} not in whitelist. Allowed: ${whitelist.join(', ')}`;
        console.warn('[CORS]', msg);
        callback(new Error(msg)); // Pass error to callback
    }
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Pre-flight requests

// --- Logging Middleware (Simplified) ---
app.use((req, res, next) => {
    console.log(`LOG: REQUEST: ${req.method} ${req.originalUrl}`);
    next();
});

// --- Database Connection Check Middleware (Supabase specific) ---
let isDbConnected = false; // Naive flag, Supabase client handles connections.
const dbCheckMiddleware = async (req, res, next) => {
    try {
        // Simple check: try to get user. More robust checks could query a small table.
        // Supabase client manages its connection pool, so an explicit connect/disconnect per request isn't typical.
        // This check is more about ensuring the client can communicate.
        const { data, error } = await supabase.auth.getUser().catch(err => ({ data: null, error: err })); // Catch potential promise rejection

        if (error && error.message !== 'Auth session missing!') { // "Auth session missing" is normal if no user logged in
            console.error('Supabase connection/auth check error (middleware):', error.message);
            // Allow /api health check to pass even if DB has issues for more granular health reporting
            if (req.originalUrl.startsWith('/api/health')) {
                return next();
            }
            isDbConnected = false;
            return res.status(503).json({ status: 'error', message: 'Service temporarily unavailable (DB Communication Issue)' });
        }
        isDbConnected = true; // If no critical error, assume communication is possible
        next();
    } catch (error) {
        console.error('Database connection middleware unexpected error:', error.message);
        isDbConnected = false;
        // Allow /api health check to pass
        if (req.originalUrl.startsWith('/api/health')) {
            return next();
        }
        next(error); // Pass to global error handler
    }
};

// --- Health Check Route ---
app.get('/api/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok', 
        message: 'API is running', 
        timestamp: new Date().toISOString(),
        databaseConnected: isDbConnected // Reflects the last check
    });
});

// --- API Routes ---
// Special raw body parser for Polar webhooks - place before routes that use it
app.use('/api/webhooks/polar', express.raw({ type: 'application/json' }));

// Apply DB check middleware to routes that need DB access.
// Webhooks might need DB access to update order status, so they get it.
// Product and order routes definitely need it.

// Admin routes are separate and use session auth, might also need DB.
app.use('/api/admin', dbCheckMiddleware, adminRoutes);

app.use('/api/products', dbCheckMiddleware, productRoutes);
app.use('/api/orders', dbCheckMiddleware, orderRoutes);
app.use('/api/webhooks', dbCheckMiddleware, webhookRoutes);


// --- Error Handling Middleware ---
// 404 Handler (Not Found)
app.use((req, res, next) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('GLOBAL ERROR HANDLER:', err.message);
  console.error(err.stack);
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  res.status(statusCode).json({ message, ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }) });
});


// --- Server Startup ---
// For Vercel, we export the app. Vercel handles the listening part.
// For local development, we can add app.listen.
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
        // Perform a startup DB check for local dev convenience
        (async () => {
            try {
                const { data, error } = await supabase.auth.getUser().catch(e => ({ data: null, error: e }));
                if (error && error.message !== 'Auth session missing!') {
                    console.warn('Local Dev: Initial Supabase connection check failed/warned:', error.message);
                } else {
                    console.log('Local Dev: Initial Supabase connection check successful (or no auth error).');
                }
            } catch(e) {
                 console.error('Local Dev: Supabase startup check CRITICAL error:', e.message);
            }
        })();
    });
}

// --- Graceful Shutdown (Primarily for local dev, Vercel handles its own lifecycle) ---
process.on('SIGTERM', async () => {
    console.log('SIGTERM received. Shutting down gracefully (local dev).');
    // Supabase client doesn't have an explicit disconnect method like Prisma.
    // Connections are managed by the pool.
    // If there were other resources to clean up, do it here.
    console.log('No specific DB disconnect needed for Supabase client.');
    process.exit(0);
});

module.exports = app; // Export the app for Vercel