const { Router } = require('express');
const {
    getAdminOrderDetailById,
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

// Create a Supabase client instance with the Service Role Key for admin operations
const supabaseAdmin = createClient(process.env.SUPABASE_URL, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
});

// Configure multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Middleware to check if user is admin and logged in
const isAdminAuthenticated = async (req, res, next) => { 
  const userId = req.cookies.admin_auth; 

  if (!userId) {
    console.log('[Auth Middleware] No admin_auth cookie found. Redirecting to login.');
    return res.redirect('/api/admin/login');
  }

  try {
    // Validate user ID against Supabase Auth users using the admin client
    const { data: user, error } = await supabaseAdmin.auth.admin.getUserById(userId);

    if (error || !user) {
      console.error('[Auth Middleware] Supabase Auth user validation failed:', error ? error.message : 'User not found in Supabase Auth');
      res.clearCookie('admin_auth');
      return res.redirect('/api/admin/login');
    }

    console.log('[Auth Middleware] User found in Supabase Auth:', user.user.id);
    req.user = { id: user.user.id, email: user.user.email }; 
    next();

  } catch (e) {
    console.error('[Auth Middleware] Unexpected error during validation:', e.message);
    res.clearCookie('admin_auth'); 
    res.status(500).send('Authentication internal error.');
  }
};

// Login routes
router.get('/login', (req, res) => {
  // If admin_auth cookie exists, redirect to dashboard
  if (req.cookies && req.cookies.admin_auth) {
      return res.redirect('/api/admin/dashboard');
  }
  // Otherwise, serve the login page
  res.sendFile('login.html', { root: path.join(__dirname, '../views/admin') });
});


router.get('/dashboard', isAdminAuthenticated, (req, res) => {
  res.sendFile('dashboard.html', { root: path.join(__dirname, '../views/admin') });
});
router.get('/products', isAdminAuthenticated, (req, res) => {
  res.sendFile('products.html', { root: path.join(__dirname, '../views/admin') });
});
router.get('/products/new', isAdminAuthenticated, (req, res) => {
  res.sendFile('new_product.html', { root: path.join(__dirname, '../views/admin') });
});
router.get('/products/edit/:id', isAdminAuthenticated, (req, res) => {
  res.sendFile('edit_product.html', { root: path.join(__dirname, '../views/admin') });
});
router.get('/orders', isAdminAuthenticated, (req, res) => {
  res.sendFile('orders.html', { root: path.join(__dirname, '../views/admin') });
});
router.get('/orders/:id', isAdminAuthenticated, (req, res) => {
  res.sendFile('order_detail.html', { root: path.join(__dirname, '../views/admin') });
});



// Modify routes to use multer middleware for file uploads
router.get('/dashboard-stats', isAdminAuthenticated, getDashboardStatsApi);
router.post('/products', isAdminAuthenticated, upload.fields([{ name: 'main_image', maxCount: 1 }, { name: 'sub_images', maxCount: 99 }, { name: 'received_images', maxCount: 99 }]), postAdminCreateProduct);
router.post('/products/edit/:id', isAdminAuthenticated, upload.fields([{ name: 'main_image', maxCount: 1 }, { name: 'sub_images', maxCount: 10 }, { name: 'received_images', maxCount: 99 }]), postAdminUpdateProduct);
router.get('/products/categories', isAdminAuthenticated, getAdminProductCategories);
router.get('/products-data/:id', isAdminAuthenticated, getAdminProductByIdApi);
router.delete('/products/:id', isAdminAuthenticated, deleteAdminProduct);

router.get('/oders-data/:id', isAdminAuthenticated, getAdminOrderDetailById)
router.get('/orders-data', isAdminAuthenticated, getAdminOrdersApi);

router.post('/login', (req, res) => {
  // Clear the admin_auth cookie
  res.clearCookie('admin_auth');
  console.log('[Admin Logout] admin_auth cookie cleared. Redirecting to login.');
  res.redirect('/api/admin/login');
});

// Logout route
router.get('/logout', (req, res) => {
  // Clear the admin_auth cookie
  res.clearCookie('admin_auth');
  console.log('[Admin Logout] admin_auth cookie cleared. Redirecting to login.');
  res.redirect('/api/admin/login');
});



// Export isAdminAuthenticated middleware
module.exports = router;