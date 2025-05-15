import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import session from 'express-session'; // Import express-session
// import ejs from 'ejs'; // EJS is usually set via app.set, direct import not always needed for basic use

import productRoutes from './routes/productRoutes';
import orderRoutes from './routes/orderRoutes';
import webhookRoutes from './routes/webhookRoutes';
import { initDb } from './config/db';
import adminRoutes from './routes/adminRoutes'; // Import admin routes

// Configure dotenv to load .env file from the backend directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const port = process.env.PORT || 3001;

// Middleware to parse URL-encoded bodies (as sent by HTML forms)
app.use(express.urlencoded({ extended: true }));

// IMPORTANT: For webhook signature verification, we need the raw body for the webhook route.
// This should come BEFORE the global express.json() parser.
// Assuming your Polar webhook is at a path like '/api/webhooks/polar'
app.use('/api/webhooks/polar', express.raw({ type: 'application/json' }));

app.use(express.json()); // For parsing application/json for other API routes

// Session configuration
// IMPORTANT: Use a strong, random secret and store it in .env for production
const SESSION_SECRET = process.env.SESSION_SECRET || 'your-very-secure-and-random-secret-key';
if (SESSION_SECRET === 'your-very-secure-and-random-secret-key' && process.env.NODE_ENV === 'production') {
  console.warn('WARNING: Default SESSION_SECRET is used in production. Please set a strong secret in .env.');
}
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: true, // Set to false if you want to only save sessions when they are modified
  cookie: {
    secure: process.env.NODE_ENV === 'production', // Use secure cookies in production (requires HTTPS)
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours, for example
  }
}));

// Initialize DB connection
initDb().then((connected) => {
  if (connected) {
    console.log('Database connection test successful.');
  } else {
    console.error('Database connection test failed. Check Supabase configuration and connectivity.');
  }
}).catch(err => console.error('Database initialization error:', err));

// Routes
app.get('/api', (req: Request, res: Response) => {
  res.send('E-shop API is running!');
});
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/webhooks', webhookRoutes); // Corrected typo: webhookes -> webhooks
app.use('/admin', adminRoutes);

// Basic Error Handling
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

/* app.listen(port, () => {
  console.log(`Backend server is running on http://localhost:${port}`);
}); */

export default app;
