const { Router } = require('express');
const { createRouteHandler } = require("uploadthing/express");
const { ourFileRouter } = require("../config/uploadthing");
const { 
    getLoginPage,
    postLogin,
    getDashboardPage,
    logoutAdmin,
    getAdminProductsPage,
    getNewProductForm,
    postAdminCreateProduct,
    getAdminOrdersPage,
    getEditProductForm,
    postAdminUpdateProduct,
    getAdminOrderDetail,
    getDashboardStatsApi,
    getAdminOrdersApi,
    getAdminProductByIdApi
} = require('../controllers/adminController');
const path = require('path');
const { supabase, supabaseServiceRoleKey } = require('../config/db');
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
router.get('/login', getLoginPage);
router.post('/login', postLogin);

// Logout route
router.get('/logout', logoutAdmin);

router.get('/dashboard', isAdminAuthenticated, (req, res) => {
    res.sendFile('dashboard.html', { root: path.join(__dirname, '../views/admin') });
});

// New API route for dashboard stats (protected by admin auth)
router.get('/dashboard-stats', isAdminAuthenticated, getDashboardStatsApi);

// Product Management (Admin)
router.get('/products', isAdminAuthenticated, getAdminProductsPage);
router.get('/products/new', isAdminAuthenticated, getNewProductForm);
router.get('/products/edit/:id', isAdminAuthenticated, getEditProductForm);

// Modify routes to use multer middleware for file uploads
router.post('/products', isAdminAuthenticated, upload.fields([{ name: 'main_image', maxCount: 1 }, { name: 'sub_images', maxCount: 10 }]), postAdminCreateProduct); // Handle product creation with file uploads
router.post('/products/edit/:id', isAdminAuthenticated, upload.fields([{ name: 'main_image', maxCount: 1 }, { name: 'sub_images', maxCount: 10 }]), postAdminUpdateProduct); // Handle product update with file uploads

// Order Management (Admin)
router.get('/orders', isAdminAuthenticated, getAdminOrdersPage);
router.get('/orders/:id', getAdminOrderDetail);

// ** New API route to fetch order data (JSON) **
router.get('/orders-data', isAdminAuthenticated, getAdminOrdersApi);

// ** New API route to fetch single product data by ID (JSON) **
router.get('/products-data/:id', isAdminAuthenticated, getAdminProductByIdApi);

// Export isAdminAuthenticated middleware
module.exports = router;