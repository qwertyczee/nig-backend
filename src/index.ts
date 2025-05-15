import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import session from 'express-session';
import serverless from 'serverless-http';      // ← import serverless-http

import productRoutes from './routes/productRoutes';
import orderRoutes from './routes/orderRoutes';
import webhookRoutes from './routes/webhookRoutes';
import adminRoutes from './routes/adminRoutes';
import { initDb } from './config/db';

// Load .env (only for local development—Vercel injects env vars in prod)
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const SESSION_SECRET = process.env.SESSION_SECRET || 'changeme-in-vercel-ui';

// Basic middleware
app.use(express.urlencoded({ extended: true }));
app.use('/api/webhooks/polar', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, maxAge: 86400000 }
}));

// Initialize DB
initDb()
  .then(ok => console.log(ok ? '✔️ DB connected' : '❌ DB failed'))
  .catch(err => console.error('DB init error:', err));

// Health check
app.get('/api', (req: Request, res: Response) => {
  res.send('E-shop API is running!');
});

// Mount routes
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/admin', adminRoutes);

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

/* app.listen(port, () => {
  console.log(`Backend server is running on http://localhost:${port}`);
}); */

export const handler = serverless(app);
