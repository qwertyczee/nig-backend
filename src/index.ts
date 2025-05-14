import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import path from 'path'; // Import path module
import productRoutes from './routes/productRoutes';
import orderRoutes from './routes/orderRoutes';
import webhookRoutes from './routes/webhookRoutes'; // Import webhook routes
import { initDb } from './config/db';

// Configure dotenv to load .env file from the backend directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const port = process.env.PORT || 3001;

app.use(express.json());

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
app.use('/api/webhookes', webhookRoutes); // Register webhook routes

// Basic Error Handling
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// app.listen(port, () => {
//   console.log(`Backend server is running on http://localhost:${port}`);
// });

export default app;
