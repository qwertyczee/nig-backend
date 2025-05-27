const path = require('path');
const { supabase } = require('../config/db');
const { utapi, UTFile } = require('../config/uploadthing');

const getLoginPage = (req, res) => {
    // If admin_auth cookie exists, redirect to dashboard
    if (req.cookies && req.cookies.admin_auth) {
        return res.redirect('/api/admin/dashboard'); // Redirect to the correct dashboard route
    }
    // Otherwise, serve the login page
    res.sendFile('login.html', { root: path.join(__dirname, '../views/admin') });
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
            // Return JSON error response
            if (signInError.message.toLowerCase().includes('invalid login credentials')) {
                return res.status(401).json({ message: 'Invalid email or password.' });
            }
            return res.status(400).json({ message: 'Login failed. Please try again.' });
        }

        if (data.user) {
            console.log('[Admin Login] Supabase Auth successful. User:', data.user.email, 'ID:', data.user.id);

            // Set an HTTP-only cookie with admin status or token
            // Using Supabase session token might be more secure if validated on backend
            // For simplicity, let's set a flag. A real app might use JWT or similar.
            const isAdmin = true; // Assuming successful login means admin
            const userIdentifier = data.user.id; // Use user ID for the cookie value

            // Set cookie
            console.log('[Admin Login] Attempting to set admin_auth cookie for user ID:', userIdentifier);
            res.cookie('admin_auth', userIdentifier, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
                maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
                sameSite: 'lax', // Or 'strict' or 'none'
            });
            console.log('[Admin Login] admin_auth cookie setting call made.');

            console.log('[Admin Login] Cookie set. Sending success response.');
            // Return JSON success response
            res.json({ message: 'Login successful', user: { id: data.user.id, email: data.user.email } });

        } else {
            console.log('[Admin Login] Supabase signInWithPassword returned no user and no error.');
            // This case should ideally be covered by signInError, but as a fallback:
            res.status(500).json({ message: 'Login failed due to unexpected response from auth provider.' });
        }
    } catch (e) {
        console.error('[Admin Login] Unexpected error during Supabase Auth signInWithPassword:', e.message);
        // Return JSON error response for unexpected errors
        res.status(500).json({ message: 'An unexpected error occurred during login.' });
    }
};

const getDashboardPage = async (req, res) => {
  try {
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
      .from('users') 
      .select('*', { count: 'exact', head: true });

    if (productsError) console.error('Error fetching total products:', productsError.message);
    if (ordersError) console.error('Error fetching total orders:', ordersError.message);
    if (salesError) console.error('Error fetching total sales:', salesError.message);
    if (customersError) console.error('Error fetching total customers:', customersError.message);

    res.render('api/admin/dashboard', {
      totalProducts: totalProducts || 0,
      newOrders: totalOrders || 0, 
      totalSales: totalSales || 0,
      totalCustomers: totalCustomers || 0,
      user: req.session.user 
    });
  } catch (error) {
    console.error('Error rendering dashboard:', error);
    res.status(500).send('Internal Server Error');
  }
};

const logoutAdmin = (req, res) => {
  // Clear the admin_auth cookie
  res.clearCookie('admin_auth');
  console.log('[Admin Logout] admin_auth cookie cleared. Redirecting to login.');
  res.redirect('/api/admin/login');
};

const getAdminProductsPage = async (req, res) => {
    try {
        // Removed data fetching logic as client will fetch via API
        // const { data: products, error } = await supabase
        //     .from('products')
        //     .select('*');

        // if (error) {
        //     console.error('Error fetching products for admin:', error.message);
        //     return res.status(500).send('Error fetching products.');
        // }

        // Pass message as a query parameter if needed for client-side JS
        // const message = req.query.message ? '?message=' + encodeURIComponent(req.query.message) : '';
        // res.sendFile(`products.html${message}`, { root: path.join(__dirname, '../views/admin') });

        // Simple serve the static HTML file
        res.sendFile('products.html', { root: path.join(__dirname, '../views/admin') });

    } catch (error) {
        console.error('Error in getAdminProductsPage:', error);
        // Still send 500 if file serving itself fails, though less likely
        res.status(500).send('Internal Server Error');
    }
};

const getAdminOrdersPage = async (req, res) => {
    try {
        res.sendFile('orders.html', { root: path.join(__dirname, '../views/admin') });

    } catch (error) {
        console.error('Error in getAdminOrdersPage:', error);
        res.status(500).send('Internal Server Error');
    }
};

const getNewProductForm = (req, res) => {
    // Removed query parameter passing for repopulation, client-side JS will handle this if needed
    // const query = req.query; // Keep query for repopulating on error
    res.sendFile('new_product.html', { root: path.join(__dirname, '../views/admin') });
};

const postAdminCreateProduct = async (req, res) => {
    console.log('[Admin Controller] postAdminCreateProduct: FUNKCE ZAVOLÁNA.');
    console.log('[Admin Controller] postAdminCreateProduct: Request body:', JSON.stringify(req.body, null, 2));
    // Access files from req.files due to multer middleware
    console.log('[Admin Controller] postAdminCreateProduct: Request files:', req.files);

    const { name, description, price, category, likes, is_18_plus, mail_content, in_stock } = req.body;
    const mainImageMulterFile = req.files?.main_image?.[0]; // Get main image file from multer
    const subImagesMulterFiles = req.files?.sub_images; // Get sub image files from multer

    if (!name || price === undefined || parseFloat(price) < 0) {
        console.error('[Admin Controller] postAdminCreateProduct: Chyba: Jméno a nezáporná cena jsou povinné. Name:', name, 'Price:', price);
        return res.status(400).json({ error: 'Name and a non-negative price are required' });
    }

    const isInStock = in_stock === 'true' || in_stock === 'on' || false;
    const is18Plus = is_18_plus === 'true' || is_18_plus === 'on' || false;

    let main_image_url = null;
    const sub_image_urls = [];

    try {
        // Upload main image to UploadThing if provided, using UTFile
        if (mainImageMulterFile) {
            console.log('[Admin Controller] Uploading main image...', mainImageMulterFile.originalname);
            // Create a UTFile instance from the multer buffer and originalname
            const mainImageUTFile = new UTFile(
                mainImageMulterFile.buffer,
                mainImageMulterFile.originalname,
                // Optional: specify content type if available from multer, though buffer might lose it
                { type: mainImageMulterFile.mimetype } // Pass mimetype
            );
            // Pass the single file in an array to uploadFiles
            const mainImageUploadResult = await utapi.uploadFiles([mainImageUTFile], { key: 'productImages' }); // Specify the productImages route

            // Check if the upload was successful and get the URL from the first element
            if (mainImageUploadResult && mainImageUploadResult.length > 0 && mainImageUploadResult[0].data?.ufsUrl) {
                // Extract the URL from the data object (use data.url or data.ufsUrl)
                main_image_url = mainImageUploadResult[0].data.ufsUrl; // Use .ufsUrl as recommended
                // Note: UploadThing recommends using .data.ufsUrl in v9+.
                console.log('[Admin Controller] Main image uploaded. URL:', main_image_url);
            } else {
                console.error('[Admin Controller] Failed to upload main image.', mainImageUploadResult?.[0]?.error || mainImageUploadResult);
                return res.status(500).json({ error: 'Failed to upload main image.' });
            }
        }

        // Upload sub images to UploadThing if provided, using UTFile for each
        if (subImagesMulterFiles && subImagesMulterFiles.length > 0) {
            console.log('[Admin Controller] Uploading sub images...', subImagesMulterFiles.length);
            
            // Map multer files to UTFile instances
            const subImageUTFiles = subImagesMulterFiles.map(file => new UTFile(file.buffer, file.originalname, { type: file.mimetype })); // Pass mimetype

            const subImagesUploadResult = await utapi.uploadFiles(subImageUTFiles, { key: 'productImages' }); // Specify the productImages route

            // Check if all uploads were successful and get URLs (check data.url for each)
            if (subImagesUploadResult && subImagesUploadResult.length === subImageUTFiles.length && subImagesUploadResult.every(file => file.data?.ufsUrl)) {
                // Extract URLs from the data object for each file
                const urls = subImagesUploadResult.map(file => file.data.ufsUrl); // Use .ufsUrl as recommended
                sub_image_urls.push(...urls);
                console.log('[Admin Controller] Sub images uploaded. URLs:', sub_image_urls);
            } else {
                console.error('[Admin Controller] Failed to upload one or more sub images.', subImagesUploadResult);
                // Find specific errors if available
                const errors = subImagesUploadResult?.map(file => file.error?.message || 'Unknown upload error').join(', ');
                return res.status(500).json({ error: 'Failed to upload one or more sub images. Details: ' + errors });
            }
        }

        // Handle likes array (assuming comma-separated string from frontend text input, or JSON from hidden input)
        let likesArray = [];
        if (likes) {
            try {
                // Attempt to parse as JSON array first (from hidden input)
                const parsedLikes = JSON.parse(likes);
                if (Array.isArray(parsedLikes)) {
                    likesArray = parsedLikes.map(item => item.trim()).filter(item => item !== '');
                } else {
                    // Fallback to comma-separated string split
                    likesArray = likes.split(',').map(item => item.trim()).filter(item => item !== '');
                }
            } catch (e) {
                // If JSON parsing fails, assume comma-separated string
                likesArray = likes.split(',').map(item => item.trim()).filter(item => item !== '');
            }
        }

        const productDataForSupabase = {
            name,
            description: description || null,
            price: parseFloat(price),
            category: category || null,
            main_image_url: main_image_url, 
            sub_image_urls: sub_image_urls, 
            likes: likesArray, 
            is_18_plus: is18Plus,
            mail_content: mail_content || null,
            in_stock: isInStock,
        };

        console.log('[Admin Controller] postAdminCreateProduct: Pokus o vytvoření produktu v Supabase. Jméno:', productDataForSupabase.name);
        const { data, error: supabaseError } = await supabase
            .from('products')
            .insert([productDataForSupabase])
            .select()
            .single();

        if (supabaseError) {
            console.error('[Admin Controller] postAdminCreateProduct: Chyba při vytváření produktu v Supabase:', supabaseError.message);
            return res.status(400).json({ error: 'DB Error: ' + supabaseError.message });
        }
        console.log('[Admin Controller] postAdminCreateProduct: Produkt vytvořen v Supabase. ID:', data.id);
        res.status(201).json({ message: 'Product created successfully', product: data });

    } catch (error) {
        console.error('[Admin Controller] postAdminCreateProduct: === CELKOVÁ CHYBA V postAdminCreateProduct ===:', error.message, error.stack);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Unexpected error: ' + error.message });
        }
    }
};

const getEditProductForm = async (req, res) => {
    try {
        res.sendFile('edit_product.html', { root: path.join(__dirname, '../views/admin') });
    } catch (error) {
        console.error('Error in getEditProductForm:', error);
        res.status(500).send('Internal Server Error');
    }
};

const postAdminUpdateProduct = async (req, res) => {
    console.log('[Admin Controller] postAdminUpdateProduct: FUNCTION CALLED.');
    console.log('[Admin Controller] postAdminUpdateProduct: Request body:', JSON.stringify(req.body, null, 2));
    console.log('[Admin Controller] postAdminUpdateProduct: Request files:', req.files);

    const { id } = req.params;
    const { name, description, price, category, main_image_url, likes, is_18_plus, mail_content, in_stock } = req.body;
    const mainImageMulterFile = req.files?.main_image?.[0]; // New main image file from multer (if uploaded)
    const subImagesMulterFiles = req.files?.sub_images; // New sub image files from multer (if uploaded)

    if (!name || price === undefined || parseFloat(price) < 0) {
        console.error('[Admin Controller] postAdminUpdateProduct: Error: Name and non-negative price are required.');
        return res.status(400).json({ error: 'Name and a non-negative price are required' });
    }

    const isInStock = in_stock === 'true' || in_stock === 'on' || false;
    const is18Plus = is_18_plus === 'true' || is_18_plus === 'on' || false;

    let new_main_image_url = main_image_url; // Start with existing URL from form field
    let existing_sub_image_urls = [];

    // Handle existing sub_image_urls from the form (should be JSON string from hidden input)
    const existingSubImageUrlsJson = req.body.sub_image_urls; 
    if (existingSubImageUrlsJson) {
        try {
            existing_sub_image_urls = JSON.parse(existingSubImageUrlsJson);
            if (!Array.isArray(existing_sub_image_urls)) throw new Error('Not an array');
            // Filter out any empty strings that might result from manual input
            existing_sub_image_urls = existing_sub_image_urls.filter(url => url !== '');
        } catch (e) {
            console.error('[Admin Controller] Failed to parse existing sub_image_urls JSON:', e);
            // If parsing fails, maybe it's a comma-separated string from an older form version or manual input?
            // Fallback to comma-separated split, but log a warning.
            console.warn('[Admin Controller] Attempting to parse sub_image_urls as comma-separated string.');
            const existingSubImageUrlsString = req.body.sub_image_urls_input; // Assuming this text input exists for manual input
            if (existingSubImageUrlsString) {
                existing_sub_image_urls = existingSubImageUrlsString.split(',').map(url => url.trim()).filter(url => url !== '');
            }
        }
    }

    const new_sub_image_urls = [];

    try {
        // Upload new main image to UploadThing if provided, using UTFile
        if (mainImageMulterFile) {
            console.log('[Admin Controller] Uploading new main image...', mainImageMulterFile.originalname);
             // Create a UTFile instance
            const mainImageUTFile = new UTFile(
                mainImageMulterFile.buffer,
                mainImageMulterFile.originalname,
                { type: mainImageMulterFile.mimetype } // Pass mimetype
            );
            // Pass the single file in an array to uploadFiles
            const mainImageUploadResult = await utapi.uploadFiles([mainImageUTFile], { key: 'productImages' }); // Specify the productImages route
            
            // Check if the upload was successful and get the URL from the first element
            if (mainImageUploadResult && mainImageUploadResult.length > 0 && mainImageUploadResult[0].data?.ufsUrl) {
                // Extract the URL from the data object (use data.url or data.ufsUrl)
                new_main_image_url = mainImageUploadResult[0].data.ufsUrl; // Use .ufsUrl as recommended
                // Note: UploadThing recommends using .data.ufsUrl in v9+.
                console.log('[Admin Controller] New main image uploaded. URL:', new_main_image_url);
                // Optional: Delete the old main image if a new one was uploaded and replace was intended
                // This requires getting the old URL from the database first before updating
                // and then using utapi.deleteFiles(oldUrlKey); -- Requires storing/retrieving keys, not just URLs.
            } else {
                console.error('[Admin Controller] Failed to upload new main image.', mainImageUploadResult?.[0]?.error || mainImageUploadResult);
                return res.status(500).json({ error: 'Failed to upload new main image.' });
            }
        } else if (main_image_url === '') {
            // If no new file uploaded and the main_image_url field was explicitly cleared on the frontend
            new_main_image_url = null;
            // Optional: Delete the old main image from UploadThing if it existed
            // This requires getting the old URL/key from the database before updating
        }

        // Upload new sub images to UploadThing if provided, using UTFile for each
        if (subImagesMulterFiles && subImagesMulterFiles.length > 0) {
            console.log('[Admin Controller] Uploading new sub images...', subImagesMulterFiles.length);

            // Map multer files to UTFile instances
            const subImageUTFiles = subImagesMulterFiles.map(file => new UTFile(file.buffer, file.originalname, { type: file.mimetype })); // Pass mimetype

            const subImagesUploadResult = await utapi.uploadFiles(subImageUTFiles, { key: 'productImages' }); // Specify the productImages route

            // Check if all uploads were successful and get URLs (check data.url for each)
            if (subImagesUploadResult && subImagesUploadResult.length === subImageUTFiles.length && subImagesUploadResult.every(file => file.data?.ufsUrl)) {
                // Extract URLs from the data object for each file
                const urls = subImagesUploadResult.map(file => file.data.ufsUrl); // Use .ufsUrl as recommended
                new_sub_image_urls.push(...urls);
                console.log('[Admin Controller] New sub images uploaded. URLs:', new_sub_image_urls);
            } else {
                console.error('[Admin Controller] Failed to upload one or more new sub images.', subImagesUploadResult);
                const errors = subImagesUploadResult?.map(file => file.error?.message || 'Unknown upload error').join(', ');
                return res.status(500).json({ error: 'Failed to upload one or more new sub images. Details: ' + errors });
            }
        }

        // Combine existing (from hidden input) and new (uploaded) sub image URLs
        const final_sub_image_urls = [...existing_sub_image_urls, ...new_sub_image_urls];

        // Handle likes array (should be JSON string from hidden input)
        let likesArray = [];
        if (likes) {
            try {
                likesArray = JSON.parse(likes);
                if (!Array.isArray(likesArray)) throw new Error('Not an array');
                likesArray = likesArray.map(item => item.trim()).filter(item => item !== '');
            } catch (e) {
                console.error('[Admin Controller] Failed to parse likes JSON:', e);
                // Fallback to comma-separated split if JSON parsing fails, log warning.
                console.warn('[Admin Controller] Attempting to parse likes as comma-separated string.');
                const likesInputString = req.body.likes_input; // Assuming this text input exists
                if (likesInputString) {
                    likesArray = likesInputString.split(',').map(item => item.trim()).filter(item => item !== '');
                }
            }
        }

        const productDataForUpdate = {
            name,
            description: description || null,
            price: parseFloat(price),
            category: category || null,
            main_image_url: new_main_image_url, 
            sub_image_urls: final_sub_image_urls, 
            likes: likesArray, 
            is_18_plus: is18Plus,
            mail_content: mail_content || null,
            in_stock: isInStock,
        };

        console.log('[Admin Controller] postAdminUpdateProduct: Attempting to update product in Supabase. ID:', id, 'Data:', productDataForUpdate);
        const { data, error: supabaseError } = await supabase
            .from('products')
            .update(productDataForUpdate)
            .eq('id', id)
            .select()
            .single();

        if (supabaseError) {
            console.error('[Admin Controller] postAdminUpdateProduct: Error updating product in Supabase:', supabaseError.message);
            return res.status(400).json({ error: 'DB Error: ' + supabaseError.message });
        }
        console.log('[Admin Controller] postAdminUpdateProduct: Product updated in Supabase. ID:', data.id);
        res.json({ message: 'Product updated successfully', product: data });

    } catch (error) {
        console.error('[Admin Controller] postAdminUpdateProduct: === GENERAL ERROR IN postAdminUpdateProduct ===:', error.message, error.stack);
        if (!res.headersSent) {
             res.status(500).json({ error: 'Unexpected error: ' + error.message });
        }
    }
};

const getAdminOrderDetail = async (req, res) => {
    try {
        // Removed data fetching logic as client will fetch via API
        // const { id } = req.params;
        // const { data: order, error } = await supabase
        //     .from('orders')
        //     .select('*')
        //     .eq('id', id)
        //     .single();

        // if (error || !order) {
        //     return res.status(404).send('Order not found');
        // }

        // Removed passing order data to render, client-side JS will fetch
        // res.render('admin/order_detail', { order });

        // Simply serve the static HTML file
        res.sendFile('order_detail.html', { root: path.join(__dirname, '../views/admin') });

    } catch (err) {
        res.status(500).send('Internal Server Error');
    }
};

const getDashboardStatsApi = async (req, res) => {
    try {
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
            .from('users')
            .select('*', { count: 'exact', head: true });

        if (productsError) console.error('Error fetching total products for API:', productsError.message);
        if (ordersError) console.error('Error fetching total orders for API:', ordersError.message);
        if (salesError) console.error('Error fetching total sales for API:', salesError.message);
        if (customersError) console.error('Error fetching total customers for API:', customersError.message);

        res.json({
            totalProducts: totalProducts || 0,
            totalOrders: totalOrders || 0,
            totalSales: totalSales || 0,
            totalCustomers: totalCustomers || 0,
        });

    } catch (error) {
        console.error('Error in getDashboardStatsApi:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

const getAdminOrdersApi = async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;
        const from = (page - 1) * limit;
        const to = from + limit - 1;

        const { count, error: countError } = await supabase
            .from('orders')
            .select('*', { count: 'exact', head: true });

        if (countError) {
            console.error('Error fetching order count for API:', countError.message);
            return res.status(500).json({ error: 'Error fetching order count.' });
        }

        const { data: orders, error } = await supabase
            .from('orders')
            .select('*')
            .order('created_at', { ascending: false })
            .range(from, to);

        if (error) {
            console.error('Error fetching orders for API:', error.message);
            return res.status(500).json({ error: 'Error fetching orders.' });
        }

        const totalPages = Math.ceil((count || 0) / limit);

        res.json({
            orders,
            totalPages,
            currentPage: page
        });

    } catch (error) {
        console.error('Error in getAdminOrdersApi:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

const getAdminProductByIdApi = async (req, res) => {
    try {
        const { id } = req.params;
        const { data: product, error } = await supabase
            .from('products')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !product) {
            console.error('Error fetching product for API:', error ? error.message : 'Product not found');
            return res.status(404).json({ error: 'Product not found.' });
        }
        
        // Ensure fields that might be null or undefined have default client-friendly values
        product.sub_image_urls = product.sub_image_urls || [];
        product.likes = product.likes || [];
        product.is_18_plus = product.is_18_plus || false;
        product.in_stock = product.in_stock || false;
        product.description = product.description || '';
        product.main_image_url = product.main_image_url || '';
        product.mail_content = product.mail_content || '';
        product.category = product.category || '';

        res.json(product);
    } catch (error) {
        console.error('Error in getAdminProductByIdApi:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};


// --- Database Connection Check Middleware (Supabase specific) ---
let isDbConnected = false; // Naive flag, Supabase client handles connections.
const dbCheckMiddleware = async (req, res, next) => {
    try {
        // Simple check: try to get user. More robust checks could query a small table.
        // Supabase client manages its connection pool, so an explicit connect/disconnect per request isn't typical.
        // This check is more about ensuring the client can communicate.
        const { data, error } = await supabase.auth.getUser().catch(err => ({ data: null, error: err })); // Catch potential promise rejection

        // Allow /api health check to pass even if DB has issues for more granular health reporting
        if (req.originalUrl.startsWith('/api/health')) {
            console.log('LOG: dbCheckMiddleware: Bypassing DB check for', req.originalUrl);
            isDbConnected = true; // Assume connected for these routes for status reporting if needed
            return next();
        }

        if (error && error.message !== 'Auth session missing!') { // "Auth session missing" is normal if no user logged in
            console.error('Supabase connection/auth check error (middleware):', error.message);

            isDbConnected = false;
            return res.status(503).json({ status: 'error', message: 'Service temporarily unavailable (DB Communication Issue)' });
        }
        isDbConnected = true; // If no critical error, assume communication is possible
        next();
    } catch (error) {
        console.error('Database connection middleware unexpected error:', error.message);
        isDbConnected = false;
        // Allow /api health check to pass
        if (req.originalUrl.startsWith('/api/health')) {
            return next();
        }
        next(error); // Pass to global error handler
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
    getEditProductForm,
    postAdminUpdateProduct,
    getAdminOrderDetail,
    getDashboardStatsApi,
    getAdminOrdersApi,
    getAdminProductByIdApi
};
