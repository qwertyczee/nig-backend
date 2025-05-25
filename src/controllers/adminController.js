const path = require('path');
const { supabase } = require('../config/db');
const polarApiKey = process.env.POLAR_SECRET_KEY;

if (!polarApiKey) {
    console.warn('[Admin Controller] POLAR_SECRET_KEY is not set. Some functionalities might be limited.');
    // It's a warning, not a hard error, as product creation might still work without Polar integration for now.
}

const getLoginPage = (req, res) => {
  // If already logged in, redirect to dashboard
  if (req.session.user?.isAdmin) {
    return res.redirect('/admin/dashboard');
  }
  const error = req.query.error ? decodeURIComponent(req.query.error.replace(/\+/g, ' ')) : null;
  res.render('admin/login', { error });
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

const getDashboardPage = async (req, res) => {
  try {
    // Fetch data for dashboard (replace with actual database queries)
    const { count: totalProducts, error: productsError } = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true });

    const { count: totalOrders, error: ordersError } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true });

    const { data: salesData, error: salesError } = await supabase
      .from('orders')
      .select('total_amount');

    let totalSales = 0;
    if (salesData) {
        totalSales = salesData.reduce((sum, order) => sum + order.total_amount, 0);
    }

    const { count: totalCustomers, error: customersError } = await supabase
      .from('users') // Assuming you have a 'users' table or similar for customers
      .select('*', { count: 'exact', head: true });

    if (productsError) console.error('Error fetching total products:', productsError.message);
    if (ordersError) console.error('Error fetching total orders:', ordersError.message);
    if (salesError) console.error('Error fetching total sales:', salesError.message);
    if (customersError) console.error('Error fetching total customers:', customersError.message);

    res.render('admin/dashboard', {
      totalProducts: totalProducts || 0,
      newOrders: totalOrders || 0, // For simplicity, using totalOrders as new orders for now
      totalSales: totalSales || 0,
      totalCustomers: totalCustomers || 0,
      user: req.session.user // Pass user data to the template
    });
  } catch (error) {
    console.error('Error rendering dashboard:', error);
    res.status(500).send('Internal Server Error');
  }
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
const getAdminProductsPage = async (req, res) => {
    try {
        const { data: products, error } = await supabase
            .from('products')
            .select('*');

        if (error) {
            console.error('Error fetching products for admin:', error.message);
            return res.status(500).send('Error fetching products.');
        }

        res.render('admin/products', { products });
    } catch (error) {
        console.error('Error in getAdminProductsPage:', error);
        res.status(500).send('Internal Server Error');
    }
};

const getAdminOrdersPage = async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = 10;
        const from = (page - 1) * limit;
        const to = from + limit - 1;

        // Get total count
        const { count, error: countError } = await supabase
            .from('orders')
            .select('*', { count: 'exact', head: true });

        if (countError) {
            console.error('Error fetching order count:', countError.message);
            return res.status(500).send('Error fetching order count.');
        }

        // Get paginated orders
        const { data: orders, error } = await supabase
            .from('orders')
            .select('*')
            .order('created_at', { ascending: false })
            .range(from, to);

        if (error) {
            console.error('Error fetching orders for admin:', error.message);
            return res.status(500).send('Error fetching orders.');
        }

        const totalPages = Math.ceil(count / limit);

        res.render('admin/orders', {
            orders,
            totalPages,
            currentPage: page
        });
    } catch (error) {
        console.error('Error in getAdminOrdersPage:', error);
        res.status(500).send('Internal Server Error');
    }
};

const getAdminSettingsPage = (req, res) => {
    // For now, provide static placeholder data for settings.
    // In a real application, these would be fetched from a database or configuration.
    const settings = {
        siteName: 'My E-commerce Store',
        adminEmail: req.session.user?.email || 'admin@example.com',
        stripeApiKey: 'sk_test_********************', // Masked for security
        lemonsqueezyApiKey: 'ls_test_********************' // Masked for security
    };
    res.render('admin/settings', { settings });
};

const getNewProductForm = (req, res) => {
    const { error, name, price, description, image_url, category } = req.query;
    res.render('admin/new_product', {
        error,
        name,
        price,
        description,
        image_url,
        category
    });
};

const postAdminCreateProduct = async (req, res) => {
    console.log('[Admin Controller] postAdminCreateProduct: FUNKCE ZAVOLÁNA.');
    console.log('[Admin Controller] postAdminCreateProduct: Request body:', JSON.stringify(req.body, null, 2));

    const { name, description, price, category, image_url, in_stock_form } = req.body;

    if (!name || price === undefined || parseFloat(price) < 0) {
        console.error('[Admin Controller] postAdminCreateProduct: Chyba: Jméno a nezáporná cena jsou povinné. Name:', name, 'Price:', price);
        return res.redirect('/admin/products/new?error=Name+and+a+non-negative+price+are+required');
    }

    const isInStock = in_stock_form === 'true' || in_stock_form === 'on' || false;

    const productDataForSupabase = {
        name,
        description: description || null,
        price: parseFloat(price),
        category: category || null,
        image_url: image_url || null,
        in_stock: isInStock,
    };

    try {
        // Only create product in Supabase, do not create in Polar
        console.log('[Admin Controller] postAdminCreateProduct: Pokus o vytvoření produktu v Supabase. Jméno:', productDataForSupabase.name);
        const { data, error: supabaseError } = await supabase
            .from('products')
            .insert([productDataForSupabase])
            .select()
            .single();

        if (supabaseError) {
            console.error('[Admin Controller] postAdminCreateProduct: Chyba při vytváření produktu v Supabase:', supabaseError.message);
            return res.redirect(`/admin/products/new?error=${encodeURIComponent('DB Error: ' + supabaseError.message)}&name=${encodeURIComponent(name || '')}&price=${encodeURIComponent(price || '')}&description=${encodeURIComponent(description || '')}&image_url=${encodeURIComponent(image_url || '')}&category=${encodeURIComponent(category || '')}`);
        }
        console.log('[Admin Controller] postAdminCreateProduct: Produkt vytvořen v Supabase. ID:', data.id);
        res.redirect('/admin/dashboard?message=Product+created+successfully');
    } catch (error) {
        console.error('[Admin Controller] postAdminCreateProduct: === CELKOVÁ CHYBA V postAdminCreateProduct ===:', error.message, error.stack);
        if (!res.headersSent) {
            res.redirect(`/admin/products/new?error=${encodeURIComponent('Unexpected error: ' + error.message)}&name=${encodeURIComponent(name || '')}&price=${encodeURIComponent(price || '')}&description=${encodeURIComponent(description || '')}&image_url=${encodeURIComponent(image_url || '')}&category=${encodeURIComponent(category || '')}`);
        }
    }
};

const getEditProductForm = async (req, res) => {
    try {
        const { id } = req.params;
        const { data: product, error } = await supabase
            .from('products')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            console.error('Error fetching product for edit:', error.message);
            return res.status(404).send('Product not found.');
        }

        res.render('admin/edit_product', { product, error: null });
    } catch (error) {
        console.error('Error in getEditProductForm:', error);
        res.status(500).send('Internal Server Error');
    }
};

const postAdminUpdateProduct = async (req, res) => {
    console.log('[Admin Controller] postAdminUpdateProduct: FUNCTION CALLED.');
    console.log('[Admin Controller] postAdminUpdateProduct: Request body:', JSON.stringify(req.body, null, 2));
    const { id } = req.params;
    const { name, description, price, category, image_url, in_stock } = req.body;

    if (!name || price === undefined || parseFloat(price) < 0) {
        console.error('[Admin Controller] postAdminUpdateProduct: Error: Name and non-negative price are required.');
        // Redirect back to edit page with error and pre-filled data
        return res.redirect(`/admin/products/edit/${id}?error=${encodeURIComponent('Name and a non-negative price are required')}&name=${encodeURIComponent(name || '')}&price=${encodeURIComponent(price || '')}&description=${encodeURIComponent(description || '')}&image_url=${encodeURIComponent(image_url || '')}&category=${encodeURIComponent(category || '')}`);
    }

    const isInStock = in_stock === 'true' || in_stock === 'on' || false;

    const productDataForUpdate = {
        name,
        description: description || null,
        price: parseFloat(price),
        category: category || null,
        image_url: image_url || null,
        in_stock: isInStock,
    };

    try {
        const { data, error: supabaseError } = await supabase
            .from('products')
            .update(productDataForUpdate)
            .eq('id', id)
            .select()
            .single();

        if (supabaseError) {
            console.error('[Admin Controller] postAdminUpdateProduct: Error updating product in Supabase:', supabaseError.message);
            return res.redirect(`/admin/products/edit/${id}?error=${encodeURIComponent('DB Error: ' + supabaseError.message)}&name=${encodeURIComponent(name || '')}&price=${encodeURIComponent(price || '')}&description=${encodeURIComponent(description || '')}&image_url=${encodeURIComponent(image_url || '')}&category=${encodeURIComponent(category || '')}`);
        }
        console.log('[Admin Controller] postAdminUpdateProduct: Product updated in Supabase. ID:', data.id);
        res.redirect('/admin/products?message=Product+updated+successfully');
    } catch (error) {
        console.error('[Admin Controller] postAdminUpdateProduct: === GENERAL ERROR IN postAdminUpdateProduct ===:', error.message, error.stack);
        if (!res.headersSent) {
            res.redirect(`/admin/products/edit/${id}?error=${encodeURIComponent('Unexpected error: ' + error.message)}&name=${encodeURIComponent(name || '')}&price=${encodeURIComponent(price || '')}&description=${encodeURIComponent(description || '')}&image_url=${encodeURIComponent(image_url || '')}&category=${encodeURIComponent(category || '')}`);
        }
    }
};

// Detail objednávky
const getAdminOrderDetail = async (req, res) => {
    const { id } = req.params;
    try {
        const { data: order, error } = await supabase
            .from('orders')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !order) {
            return res.status(404).send('Order not found');
        }

        res.render('admin/order_detail', { order });
    } catch (err) {
        res.status(500).send('Internal Server Error');
    }
};

module.exports = {  
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
};