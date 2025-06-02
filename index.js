const express = require('express');
require('dotenv').config();
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const { handlePrepareUpload } = require('./config/uploadthing.js')

const { supabase } = require('./config/db.js');

const productRoutes = require('./routes/productRoutes.js');
const orderRoutes = require('./routes/orderRoutes.js');
const webhookRoutes = require('./routes/webhookRoutes.js');
const adminRoutes = require('./routes/adminRoutes.js');

console.log('LOG: index.js: dotenv.config executed.');
console.log('LOG: index.js: SUPABASE_URL loaded:', !!process.env.SUPABASE_URL);
console.log('LOG: index.js: SESSION_SECRET loaded:', !!process.env.SESSION_SECRET);

/**
 * Handles unhandled promise rejections.
 * @param {Error} reason - The reason for the unhandled rejection.
 * @param {Promise} promise - The promise that was rejected.
 */
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

/**
 * Handles uncaught exceptions.
 * @param {Error} error - The uncaught exception.
 */
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

const PORT = process.env.PORT || 3001;
const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.set('trust proxy', 1);

/**
 * Middleware to parse raw JSON for specific webhook routes.
 */
app.use('/api/webhooks/lemonsqueezy', express.raw({ type: 'application/json' }));

/**
 * Middleware to parse JSON and URL-encoded request bodies.
 */
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/**
 * Middleware to parse cookies.
 */
app.use(cookieParser());

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const whitelist = [FRONTEND_URL, 'http://localhost:3000', 'http://localhost:3001', 'https://www.slavesonline.store', 'http://www.slavesonline.store', 'https://slavesonline.store', 'http://slavesonline.store', 'https://api.slavesonline.store'];
if (process.env.VERCEL_URL) {
    whitelist.push(`https://${process.env.VERCEL_URL}`);
}

/**
 * CORS configuration for allowing cross-origin requests.
 */
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
    maxAge: 86400,
    origin: (incomingOrigin, callback) => {
        console.log('[CORS] incoming origin:', incomingOrigin);
        if (!incomingOrigin || whitelist.includes(incomingOrigin)) {
            return callback(null, true);
        }
        const msg = `Origin ${incomingOrigin} not in whitelist. Allowed: ${whitelist.join(', ')}`;
        console.warn('[CORS]', msg);
        callback(new Error(msg));
    }
};

/**
 * Applies CORS middleware to all routes.
 */
app.use(cors(corsOptions));

/**
 * Handles pre-flight requests for CORS.
 */
app.options('*', cors(corsOptions));

/**
 * Logging middleware to log incoming requests.
 */
app.use((req, res, next) => {
    console.log(`LOG: REQUEST: ${req.method} ${req.originalUrl}`);
    next();
});

let isDbConnected = false;
/**
 * Middleware to check the Supabase database connection status.
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 * @param {function} next - The next middleware function.
 */
const dbCheckMiddleware = async (req, res, next) => {
    try {
        const { data, error } = await supabase.auth.getUser().catch(err => ({ data: null, error: err }));

        if (error && error.message !== 'Auth session missing!') {
            console.error('Supabase connection/auth check error (middleware):', error.message);
            if (req.originalUrl.startsWith('/api/health')) {
                return next();
            }
            isDbConnected = false;
            return res.status(503).json({ status: 'error', message: 'Service temporarily unavailable (DB Communication Issue)' });
        }
        isDbConnected = true;
        next();
    } catch (error) {
        console.error('Database connection middleware unexpected error:', error.message);
        isDbConnected = false;
        if (req.originalUrl.startsWith('/api/health')) {
            return next();
        }
        next(error);
    }
};

/**
 * Health check route to verify API status and database connection.
 * @route GET /api/health
 */
app.get('/api/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok', 
        message: 'API is running', 
        timestamp: new Date().toISOString(),
        databaseConnected: isDbConnected
    });
});

/**
 * Mounts admin routes with database connection check.
 */
app.use('/api/admin', dbCheckMiddleware, adminRoutes);

/**
 * Mounts product routes with database connection check.
 */
app.use('/api/products', dbCheckMiddleware, productRoutes);

/**
 * Mounts order routes with database connection check.
 */
app.use('/api/orders', dbCheckMiddleware, orderRoutes);

/**
 * Mounts webhook routes with database connection check.
 */
app.use('/api/webhooks', dbCheckMiddleware, webhookRoutes);

/**
 * Mounts Uploadthing routes.
 */
app.use("/api/uploadthing", handlePrepareUpload);

/**
 * 404 Not Found handler middleware.
 */
app.use((req, res, next) => {
    res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
});

/**
 * Global error handling middleware.
 * @param {Error} err - The error object.
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 * @param {function} next - The next middleware function.
 */
app.use((err, req, res, next) => {
    console.error('GLOBAL ERROR HANDLER:', err.message);
    console.error(err.stack);
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Internal Server Error';
    res.status(statusCode).json({ message, ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }) });
});

/**
 * Starts the server in non-production environments.
 */
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
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

/**
 * Handles SIGTERM signals for graceful shutdown in local development.
 */
process.on('SIGTERM', async () => {
    console.log('SIGTERM received. Shutting down gracefully (local dev).');
    console.log('No specific DB disconnect needed for Supabase client.');
    process.exit(0);
});

module.exports = app;