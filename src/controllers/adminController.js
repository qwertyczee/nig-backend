const { Request, Response } = require('express');
const path = require('path'); // Added for sendFile
// For a real app, you'd fetch admin users from a database and use bcrypt for passwords
const bcrypt = require('bcryptjs');
const { supabase } = require('../config/db'); // Ensure supabase is imported

const getLoginPage = (req, res) => {
  // If already logged in, redirect to dashboard
  if (req.session.user?.isAdmin) {
    return res.redirect('/admin/dashboard');
  }
  res.sendFile(path.join(__dirname, '../views/admin/login.html'));
};

const postLogin = async (req, res) => {
  const { email, password } = req.body;
  console.log(`[Admin Login] Attempting Supabase Auth signInWithPassword for email: ${email}`);

  try {
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: email,
      password: password,
    });

    if (signInError) {
      console.error('[Admin Login] Supabase signInWithPassword error:', signInError.message);
      // Differentiate between invalid credentials and other errors if needed
      if (signInError.message.toLowerCase().includes('invalid login credentials')) {
        return res.redirect('/admin/login?error=Invalid+email+or+password.');
      }
      return res.redirect('/admin/login?error=Login+failed.+Please+try+again.');
    }

    if (data.user) {
      // IMPORTANT: Add a check here to ensure the user is actually an admin.
      // This could be by checking user_metadata or a custom claim.
      // For now, we'll assume any successful Supabase Auth login is an admin for this panel.
      // Example: if (!data.user.user_metadata?.is_admin) {
      //   console.log('[Admin Login] User authenticated but not an admin.');
      //   return res.render('admin/login', { error: 'Access denied. Not an admin.' });
      // }
      console.log('[Admin Login] Supabase Auth successful. User:', data.user.email, 'ID:', data.user.id);
      
      req.session.user = {
        id: data.user.id,
        email: data.user.email || '', // Supabase user email can be null
        isAdmin: true, // Assuming successful login means admin for now
      };

      req.session.save(err => {
        if (err) {
          console.error('[Admin Login] Session save error:', err);
          return res.redirect('/admin/login?error=Login+failed+to+save+session,+please+try+again.');
        }
        console.log('[Admin Login] Session saved. Redirecting to /admin/dashboard. Session ID:', req.sessionID);
        console.log('[Admin Login] Session user data:', req.session.user);
        res.redirect('/admin/dashboard');
      });
    } else {
      // This case should ideally be caught by signInError, but as a fallback:
      console.log('[Admin Login] Supabase signInWithPassword returned no user and no error.');
      res.redirect('/admin/login?error=Login+failed.+Please+try+again.');
    }
  } catch (e) {
    console.error('[Admin Login] Unexpected error during Supabase Auth signInWithPassword:', e.message);
    res.redirect('/admin/login?error=An+unexpected+error+occurred.+Please+try+again.');
  }
};

const getDashboardPage = (req, res) => {
  // This page should be protected by middleware (see adminRoutes.ts)
  res.send(`
    <h1>Admin Dashboard</h1>
    <p>Welcome, ${req.session.user?.email}!</p>
    <p><a href="/admin/logout">Logout</a></p>
    <p><a href="/admin/products/new">Add New Product</a></p>
    <p><a href="/admin/products">Manage Products</a></p> 
    `); 
    // In a real app, render an EJS template: 
    // res.render('admin/dashboard', { user: req.session.user });
};

const logoutAdmin = (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Session destruction error:', err);
      // Handle error, maybe redirect to an error page or login with an error message
      return res.redirect('/admin/login?error=logout_failed');
    }
    res.clearCookie('connect.sid'); // Default session cookie name, adjust if different
    res.redirect('/admin/login');
  });
};

// Placeholder for product management - will be expanded
const getAdminProductsPage = (req, res) => {
    res.send('<h1>Manage Products (Admin)</h1><p><a href="/admin/dashboard">Back to Dashboard</a></p>');
    // Later, fetch products and render a view:
    // const products = await fetchProductsFromDb();
    // res.render('admin/products', { products });
};

const getNewProductForm = (req, res) => {
    res.send(`
        <h1>Add New Product (Admin)</h1>
        <form action="/admin/products" method="POST">
            <div><label>Name: <input type="text" name="name" required></label></div>
            <div><label>Price: <input type="number" name="price" step="0.01" required></label></div>
            <div><label>Description: <textarea name="description"></textarea></label></div>
            <div><label>Image URL: <input type="text" name="image_url"></label></div>
            <div><label>Category: <input type="text" name="category"></label></div>
            <div><label>In Stock: <input type="checkbox" name="in_stock" value="true" checked></label></div>
            <button type="submit">Add Product</button>
        </form>
        <p><a href="/admin/dashboard">Back to Dashboard</a></p>
    `);
    // Later, render an EJS template:
    // res.render('admin/new-product-form', { error: null, productData: {} });
};

const postAdminCreateProduct = async (req, res) => {
    try {
        const { name, description, price, category, image_url, in_stock } = req.body;

        if (!name || price === undefined || parseFloat(price) < 0) {
            // Re-render the form with an error message and existing data
            // You'd need to create a new-product-form.ejs for this to be clean
            // For now, sending a simple error or redirecting with query param
            return res.redirect('/admin/products/new?error=Name+and+valid+price+are+required');
        }
        
        const newProductData = {
            name,
            description: description || null, // Handle optional fields
            price: parseFloat(price),
            category: category || null,
            image_url: image_url || null,
            in_stock: in_stock === 'true' || in_stock === true, // HTML checkbox might send 'on' or value, or not be present
        };

        const { data: createdProduct, error: dbError } = await supabase
            .from('products')
            .insert([newProductData])
            .select()
            .single();

        if (dbError) {
            console.error('Admin: Error creating product in DB:', dbError.message);
            // Re-render form with error
            return res.redirect(`/admin/products/new?error=${encodeURIComponent(dbError.message)}`);
        }

        // Redirect to admin products list (which we haven't fully built yet) or dashboard
        res.redirect('/admin/dashboard?message=Product+created+successfully');

    } catch (error) {
        console.error('Admin: Unexpected error creating product:', error.message);
        res.redirect(`/admin/products/new?error=Unexpected+error`);
    }
};

module.exports = {
    getLoginPage,
    postLogin,
    getDashboardPage,
    logoutAdmin,
    getAdminProductsPage,
    getNewProductForm,
    postAdminCreateProduct
};