const { Router } = require('express');
const { 
    getLoginPage,
    postLogin,
    getDashboardPage,
    logoutAdmin,
    getAdminProductsPage,
    getNewProductForm,
    postAdminCreateProduct,
    getAdminOrdersPage,
    getAdminSettingsPage,
    getEditProductForm,
    postAdminUpdateProduct,
    getAdminOrderDetail
} = require('../controllers/adminController');

const router = Router();

// Middleware to check if user is admin and logged in
const isAdminAuthenticated = (req, res, next) => {
  console.log(`[Auth Middleware] Checking auth for path: ${req.path}`);
  console.log('[Auth Middleware] Session ID:', req.sessionID);
  console.log('[Auth Middleware] Session user data:', req.session.user);
  if (req.session.user?.isAdmin) {
    console.log('[Auth Middleware] User IS admin. Proceeding.');
    return next();
  }
  console.log('[Auth Middleware] User IS NOT admin or no session. Redirecting to /admin/login.');
  res.redirect('/admin/login');
};

// Login routes
router.get('/login', getLoginPage);
router.post('/login', postLogin);

// Logout route
router.get('/logout', logoutAdmin);

// Protected admin routes (require login)
router.get('/dashboard', isAdminAuthenticated, getDashboardPage);

// Product Management (Admin)
router.get('/products', isAdminAuthenticated, getAdminProductsPage); // View all products (admin view)
router.get('/products/new', isAdminAuthenticated, getNewProductForm); // Form to add new product
router.get('/products/edit/:id', isAdminAuthenticated, getEditProductForm); // Form to edit existing product
router.post('/products/edit/:id', isAdminAuthenticated, postAdminUpdateProduct); // Handle product update

// Order Management (Admin)
router.get('/orders', isAdminAuthenticated, getAdminOrdersPage);
router.get('/orders/:id', getAdminOrderDetail);

// Settings Management (Admin)
router.get('/settings', isAdminAuthenticated, getAdminSettingsPage);

// Use the existing API controller for creating product, but ensure it's protected by admin auth.
// The `isAdminAuthenticated` middleware handles the session-based auth for the admin panel.
// The `createProduct` from `productController` expects a JSON body and responds with JSON.
// For a form post, we might need an adapter or a different controller if we want HTML response.
// However, the `postAdminCreateProduct` in `adminController` is a placeholder.
// Let's make the form POST to the API endpoint, but this requires the admin to have a "token"
// or for the API endpoint to also check session. This is getting complex.

// Simpler approach for now: The admin form POSTs to an admin-specific route,
// which then calls the logic from productController or a shared service.
// The `postAdminCreateProduct` in `adminController` is designed for this,
// but it currently just redirects. Let's make it call the actual `createProduct` logic.

// For a server-rendered form, we want the POST to be handled by a controller
// that then renders a page or redirects, not just returns JSON.
// We will use `createProduct` from `productController` but adapt the response in `adminController`.

// Let's refine `postAdminCreateProduct` in adminController.ts to call `createProduct`
// and handle the redirect/response for an HTML context.
// The route below will use the placeholder `postAdminCreateProduct` from `adminController`
// We will then update `adminController.ts` to properly call the product creation logic.
router.post('/products', isAdminAuthenticated, postAdminCreateProduct); 
// This is a temporary setup for `postAdminCreateProduct`.
// A better way would be to have `postAdminCreateProduct` in `adminController`
// call a service function that `productController.createProduct` also uses,
// so the core logic is shared and response type (JSON vs HTML redirect) is handled by the controller.

module.exports = router;