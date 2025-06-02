const { Router } = require('express');
const {
    getAdminOrderDetailById,
    postLogin,
    postAdminCreateProduct,
    postAdminUpdateProduct,
    getAdminProductCategories,
    getDashboardStatsApi,
    getAdminOrdersApi,
    getAdminProductByIdApi,
    deleteAdminProduct
} = require('../controllers/adminController');
const path = require('path');
const { supabaseServiceRoleKey } = require('../config/db');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');

const router = Router();

const supabaseAdmin = createClient(process.env.SUPABASE_URL, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
});

const upload = multer({ storage: multer.memoryStorage() });

/**
 * Middleware to check if the user is an authenticated administrator.
 * Validates the admin_auth cookie against Supabase Auth.
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 * @param {function} next - The next middleware function.
 */
const isAdminAuthenticated = async (req, res, next) => { 
  const userId = req.cookies.admin_auth; 

  if (!userId) {
    console.log('No admin_auth cookie found. Redirecting to login.');
    return res.redirect('/api/admin/login');
  }

  try {
    const { data: user, error } = await supabaseAdmin.auth.admin.getUserById(userId);

    if (error || !user) {
      console.error('Supabase Auth user validation failed:', error ? error.message : 'User not found in Supabase Auth');
      res.clearCookie('admin_auth');
      return res.redirect('/api/admin/login');
    }

    console.log('User found in Supabase Auth:', user.user.id);
    req.user = { id: user.user.id, email: user.user.email }; 
    next();

  } catch (e) {
    console.error('Unexpected error during validation:', e.message);
    res.clearCookie('admin_auth'); 
    res.status(500).send('Authentication internal error.');
  }
};

/**
 * Route to serve the admin login page.
 * If an admin_auth cookie exists, redirects to the dashboard.
 * @route GET /api/admin/login
 */
router.get('/login', (req, res) => {
  if (req.cookies && req.cookies.admin_auth) {
      return res.redirect('/api/admin/dashboard');
  }
  res.sendFile('login.html', { root: path.join(__dirname, '../views/admin') });
});

/**
 * Route to serve the admin dashboard page, protected by authentication.
 * @route GET /api/admin/dashboard
 */
router.get('/dashboard', isAdminAuthenticated, (req, res) => {
  res.sendFile('dashboard.html', { root: path.join(__dirname, '../views/admin') });
});

/**
 * Route to serve the admin products page, protected by authentication.
 * @route GET /api/admin/products
 */
router.get('/products', isAdminAuthenticated, (req, res) => {
  res.sendFile('products.html', { root: path.join(__dirname, '../views/admin') });
});

/**
 * Route to serve the admin new product creation page, protected by authentication.
 * @route GET /api/admin/products/new
 */
router.get('/products/new', isAdminAuthenticated, (req, res) => {
  res.sendFile('new_product.html', { root: path.join(__dirname, '../views/admin') });
});

/**
 * Route to serve the admin product edit page, protected by authentication.
 * @route GET /api/admin/products/edit/:id
 */
router.get('/products/edit/:id', isAdminAuthenticated, (req, res) => {
  res.sendFile('edit_product.html', { root: path.join(__dirname, '../views/admin') });
});

/**
 * Route to serve the admin orders page, protected by authentication.
 * @route GET /api/admin/orders
 */
router.get('/orders', isAdminAuthenticated, (req, res) => {
  res.sendFile('orders.html', { root: path.join(__dirname, '../views/admin') });
});

/**
 * Route to serve the admin order detail page, protected by authentication.
 * @route GET /api/admin/orders/:id
 */
router.get('/orders/:id', isAdminAuthenticated, (req, res) => {
  res.sendFile('order_detail.html', { root: path.join(__dirname, '../views/admin') });
});

/**
 * Route to get dashboard statistics for admin, protected by authentication.
 * @route GET /api/admin/dashboard-stats
 */
router.get('/dashboard-stats', isAdminAuthenticated, getDashboardStatsApi);

/**
 * Route to create a new product, protected by authentication and handles file uploads.
 * @route POST /api/admin/products
 */
router.post('/products', isAdminAuthenticated, upload.fields([{ name: 'main_image', maxCount: 1 }, { name: 'sub_images', maxCount: 99 }, { name: 'received_images', maxCount: 99 }]), postAdminCreateProduct);

/**
 * Route to update an existing product, protected by authentication and handles file uploads.
 * @route POST /api/admin/products/edit/:id
 */
router.post('/products/edit/:id', isAdminAuthenticated, upload.fields([{ name: 'main_image', maxCount: 1 }, { name: 'sub_images', maxCount: 10 }, { name: 'received_images', maxCount: 99 }]), postAdminUpdateProduct);

/**
 * Route to get product categories for admin, protected by authentication.
 * @route GET /api/admin/products/categories
 */
router.get('/products/categories', isAdminAuthenticated, getAdminProductCategories);

/**
 * Route to get product data by ID for admin, protected by authentication.
 * @route GET /api/admin/products-data/:id
 */
router.get('/products-data/:id', isAdminAuthenticated, getAdminProductByIdApi);

/**
 * Route to delete a product by ID for admin, protected by authentication.
 * @route DELETE /api/admin/products/:id
 */
router.delete('/products/:id', isAdminAuthenticated, deleteAdminProduct);

/**
 * Route to get order detail by ID for admin, protected by authentication.
 * @route GET /api/admin/oders-data/:id
 */
router.get('/oders-data/:id', isAdminAuthenticated, getAdminOrderDetailById)

/**
 * Route to get all orders data for admin, protected by authentication.
 * @route GET /api/admin/orders-data
 */
router.get('/orders-data', isAdminAuthenticated, getAdminOrdersApi);

/**
 * Route to handle admin login.
 * @route POST /api/admin/login
 */
router.post('/login', postLogin);

/**
 * Route to handle admin logout. Clears the admin_auth cookie.
 * @route GET /api/admin/logout
 */
router.get('/logout', (req, res) => {
  res.clearCookie('admin_auth');
  console.log('admin_auth cookie cleared. Redirecting to login.');
  res.redirect('/api/admin/login');
});

module.exports = router;