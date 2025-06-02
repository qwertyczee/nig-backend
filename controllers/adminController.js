const { supabase } = require('../config/db');
const { utapi, UTFile } = require('../config/uploadthing');

/**
 * Handles administrator login by authenticating with Supabase.
 * Sets an HTTP-only cookie upon successful login.
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 */
const postLogin = async (req, res) => {
    const { email, password } = req.body;
    console.log(`Attempting Supabase Auth signInWithPassword for email: ${email}`);

    try {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
            email: email,
            password: password,
        });

        if (signInError) {
            console.error('Supabase signInWithPassword error:', signInError.message);
            if (signInError.message.toLowerCase().includes('invalid login credentials')) {
                return res.status(401).json({ message: 'Invalid email or password.' });
            }
            return res.status(400).json({ message: 'Login failed. Please try again.' });
        }

        if (data.user) {
            console.log('Supabase Auth successful. User:', data.user.email, 'ID:', data.user.id);

            const isAdmin = true;
            const userIdentifier = data.user.id;

            console.log('Attempting to set admin_auth cookie for user ID:', userIdentifier);
            res.cookie('admin_auth', userIdentifier, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                maxAge: 7 * 24 * 60 * 60 * 1000,
                sameSite: 'lax',
            });
            console.log('admin_auth cookie setting call made.');

            console.log('Cookie set. Sending success response.');
            res.json({ message: 'Login successful', user: { id: data.user.id, email: data.user.email } });

        } else {
            console.log('Supabase signInWithPassword returned no user and no error.');
            res.status(500).json({ message: 'Login failed due to unexpected response from auth provider.' });
        }
    } catch (e) {
        console.error('Unexpected error during Supabase Auth signInWithPassword:', e.message);
        res.status(500).json({ message: 'An unexpected error occurred during login.' });
    }
};

/**
 * Creates a new product in the database, handling image URLs.
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 */
const postAdminCreateProduct = async (req, res) => {
    console.log('postAdminCreateProduct: FUNKCE ZAVOLÁNA.');
    console.log('postAdminCreateProduct: Request body:', JSON.stringify(req.body, null, 2));
    console.log('postAdminCreateProduct: Request files:', req.files);

    const { name, description, price, categories, new_category_input, is_18_plus, in_stock, received_text } = req.body;
    let { main_image_url, sub_image_urls, received_images_zip_url } = req.body;
    
    main_image_url = `https://rhcwjrafe0.ufs.sh/f/${main_image_url}`
    sub_image_urls = sub_image_urls.map(url => `https://rhcwjrafe0.ufs.sh/f/${url}`)
    received_images_zip_url = `https://rhcwjrafe0.ufs.sh/f/${received_images_zip_url}`

    if (!name || price === undefined || parseFloat(price) < 0) {
        console.error('postAdminCreateProduct: Chyba: Jméno a nezáporná cena jsou povinné. Name:', name, 'Price:', price);
        return res.status(400).json({ error: 'Name and a non-negative price are required' });
    }

    const is18Plus = is_18_plus === 'true' || is_18_plus === 'on' || false;

    try {
        let finalCategoriesArray = Array.isArray(categories) ? categories : (categories ? [categories] : []);
        const newCategory = new_category_input && new_category_input.trim() !== '' ? new_category_input.trim() : null;
        
        if (newCategory) {
            finalCategoriesArray.push(newCategory);
        }
        
        finalCategoriesArray = Array.from(new Set(finalCategoriesArray.filter(cat => cat !== '')));

        const categoryToStore = finalCategoriesArray.length === 0 ? [] : finalCategoriesArray;

        const productDataForSupabase = {
            name,
            description: description || null,
            price: parseFloat(price),
            category: categoryToStore,
            main_image_url: main_image_url, 
            sub_image_urls: sub_image_urls, 
            is_18_plus: is18Plus,
            in_stock: in_stock,
            received_text: received_text || null,
            received_images_zip_url: received_images_zip_url,
        };

        console.log('postAdminCreateProduct: Pokus o vytvoření produktu v Supabase. Data:', JSON.stringify(productDataForSupabase, null, 2));
        const { data, error: supabaseError } = await supabase
            .from('products')
            .insert([productDataForSupabase])
            .select()
            .single();

        if (supabaseError) {
            console.error('postAdminCreateProduct: Chyba při vytváření produktu v Supabase:', supabaseError.message);
            return res.status(400).json({ error: 'DB Error: ' + supabaseError.message });
        }
        console.log('postAdminCreateProduct: Produkt vytvořen v Supabase. ID:', data.id);
        res.status(201).json({ message: 'Product created successfully', product: data });

    } catch (error) {
        console.error('postAdminCreateProduct: === CELKOVÁ CHYBA V postAdminCreateProduct ===:', error.message, error.stack);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Unexpected error: ' + error.message });
        }
    }
};

/**
 * Updates an existing product in the database, handling image URLs.
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 */
const postAdminUpdateProduct = async (req, res) => {
    console.log('postAdminUpdateProduct: FUNCTION CALLED.');
    console.log('postAdminUpdateProduct: Request body:', JSON.stringify(req.body, null, 2));

    const { id } = req.params;
    const { name, description, price, categories, new_category_input, is_18_plus, in_stock, received_text } = req.body;
    let { main_image_url, sub_image_urls, received_images_zip_url } = req.body;

    main_image_url = `https://rhcwjrafe0.ufs.sh/f/${main_image_url}`
    sub_image_urls = sub_image_urls.map(url => `https://rhcwjrafe0.ufs.sh/f/${url}`)
    received_images_zip_url = `https://rhcwjrafe0.ufs.sh/f/${received_images_zip_url}`

    if (!name || price === undefined || parseFloat(price) < 0) {
        console.error('postAdminUpdateProduct: Error: Name and non-negative price are required.');
        return res.status(400).json({ error: 'Name and a non-negative price are required' });
    }

    const is18Plus = is_18_plus === 'true' || is_18_plus === 'on' || false;

    try {
        let finalCategoriesArray = Array.isArray(categories) ? categories : (categories ? [categories] : []);
        const newCategory = new_category_input && new_category_input.trim() !== '' ? new_category_input.trim() : null;

        if (newCategory) {
            finalCategoriesArray.push(newCategory);
        }

        finalCategoriesArray = Array.from(new Set(finalCategoriesArray.filter(cat => cat !== '')));

        const categoryToUpdate = finalCategoriesArray.length === 0 ? [] : finalCategoriesArray;

        const productDataForUpdate = {
            name,
            description: description || null,
            price: parseFloat(price),
            category: categoryToUpdate,
            main_image_url: main_image_url, 
            sub_image_urls: sub_image_urls,
            is_18_plus: is18Plus,
            in_stock: in_stock,
            received_text: received_text || null,
            received_images_zip_url: received_images_zip_url,
        };

        console.log('postAdminUpdateProduct: Attempting to update product in Supabase. ID:', id, 'Data:', JSON.stringify(productDataForUpdate, null, 2));
        const { data, error: supabaseError } = await supabase
            .from('products')
            .update(productDataForUpdate)
            .eq('id', id)
            .select()
            .single();

        if (supabaseError) {
            console.error('postAdminUpdateProduct: Error updating product in Supabase:', supabaseError.message);
            return res.status(400).json({ error: 'DB Error: ' + supabaseError.message });
        }
        console.log('postAdminUpdateProduct: Product updated in Supabase. ID:', data.id);
        res.json({ message: 'Product updated successfully', product: data });

    } catch (error) {
        console.error('postAdminUpdateProduct: === GENERAL ERROR IN postAdminUpdateProduct ===:', error.message, error.stack);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Unexpected error: ' + error.message });
        }
    }
};

/**
 * Retrieves dashboard statistics including total products, orders, sales, and customers.
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 */
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

/**
 * Retrieves a paginated list of orders for the admin panel, with optional search.
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 */
const getAdminOrdersApi = async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;
        const from = (page - 1) * limit;
        const to = from + limit - 1;
        const searchTerm = req.query.search;

        let query = supabase
            .from('orders')
            .select('*', { count: 'exact', head: true });

        if (searchTerm) {
            query = query.ilike('user_id', `%${searchTerm}%`);
        }

        const { count = 0, error: countError } = await query;

        let dataQuery = supabase
            .from('orders')
            .select('*, shipping_address_id (*), billing_address_id (*), order_items (*, products (id, name, main_image_url, description))')
            .order('created_at', { ascending: false })
            .range(from, to);

        if (searchTerm) {
            dataQuery = dataQuery.ilike('user_id', `%${searchTerm}%`);
        }

        const { data: orders, error } = await dataQuery;

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

/**
 * Retrieves a list of distinct product categories for the admin panel.
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 */
const getAdminProductCategories = async (req, res) => {
    try {
        const { data: products, error } = await supabase
            .from('products')
            .select('category');

        if (error) {
            console.error('Error fetching product categories from DB:', error.message);
            return res.status(500).json({ error: 'Failed to fetch product categories from database' });
        }

        const allCategories = products
            .map(item => item.category)
            .filter(category => category !== null && category !== '' && Array.isArray(category));

        const distinctCategories = Array.from(new Set(allCategories.flat()));

        const formattedCategories = distinctCategories
            .map(category => ({
                id: category,
                name: category.charAt(0).toUpperCase() + category.slice(1)
            }));

        res.json(formattedCategories);
    } catch (error) {
        console.error('Error in getAdminProductCategories:', error);
        res.status(500).json({ error: 'Internal Server Error fetching product categories' });
    }
};

/**
 * Retrieves a single product by ID for the admin panel.
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 */
const getAdminProductByIdApi = async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`Attempting to fetch product with ID: ${id}`);
        const { data: product, error } = await supabase
            .from('products')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !product) {
            console.error('Error fetching product for API:', error ? error.message : 'Product not found');
            if (error && error.code === 'PGRST116') {
                return res.status(404).json({ error: 'Product not found.' });
            }
            return res.status(error ? 500 : 404).json({ error: error ? 'Database error fetching product: ' + error.message : 'Product not found.' });
        }
        
        product.sub_image_urls = product.sub_image_urls || [];
        product.is_18_plus = product.is_18_plus || false;
        product.in_stock = product.in_stock || false;
        product.description = product.description || '';
        product.main_image_url = product.main_image_url || '';
        product.category = product.category || '';

        res.json(product);
    } catch (error) {
        console.error('Error in getAdminProductByIdApi:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

/**
 * Deletes a product by ID from the database and associated files from UploadThing.
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 */
const deleteAdminProduct = async (req, res) => {
    console.log('deleteAdminProduct: FUNCTION CALLED.');
    const { id } = req.params;

    if (!id) {
        console.error('deleteAdminProduct: Error: Product ID is required.');
        return res.status(400).json({ error: 'Product ID is required.' });
    }

    try {
        const { data: product, error: fetchError } = await supabase
            .from('products')
            .select('main_image_url, sub_image_urls')
            .eq('id', id)
            .single();

        if (fetchError || !product) {
            console.error(`Error fetching product ${id}:`, fetchError ? fetchError.message : 'Product not found.');
            if (!product) {
                return res.status(404).json({ error: 'Product not found.' });
            }
            return res.status(500).json({ error: 'Database error fetching product for deletion.' });
        }

        const filesToDelete = [];
        if (product.main_image_url) {
            const mainImageKey = product.main_image_url.split('/').pop();
            if (mainImageKey) filesToDelete.push(mainImageKey);
        }
        if (product.sub_image_urls && Array.isArray(product.sub_image_urls)) {
            product.sub_image_urls.forEach(url => {
                const subImageKey = url.split('/').pop();
                if (subImageKey) filesToDelete.push(subImageKey);
            });
        }

        if (filesToDelete.length > 0) {
            console.log('Attempting to delete files from UploadThing:', filesToDelete);
            try {
                const deleteResult = await utapi.deleteFiles(filesToDelete);
                console.log('UploadThing delete response:', JSON.stringify(deleteResult, null, 2));
            } catch (uploadthingError) {
                console.error('Error deleting files from UploadThing:', uploadthingError);
            }
        }

        console.log(`Attempting to delete product ${id} from Supabase.`);
        const { error: deleteError } = await supabase
            .from('products')
            .delete()
            .eq('id', id);

        if (deleteError) {
            console.error(`Error deleting product ${id} from Supabase:`, deleteError.message);
            return res.status(500).json({ error: 'Database error deleting product: ' + deleteError.message });
        }

        console.log(`Product ${id} deleted successfully.`);
        res.json({ message: 'Product deleted successfully.' });

    } catch (error) {
        console.error('=== GENERAL ERROR IN deleteAdminProduct ===:', error.message, error.stack);
        res.status(500).json({ error: 'An unexpected error occurred during product deletion.' });
    }
};

/**
 * Retrieves details of a single order by ID for the admin panel.
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 */
const getAdminOrderDetailById = async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`Attempting to fetch order with ID: ${id}`);
        const { data: order, error } = await supabase
            .from('orders')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !order) {
            console.error('Error fetching order:', error ? error.message : 'Order not found');
            if (error && error.code === 'PGRST116') {
                return res.status(404).json({ error: 'Order not found.' });
            }
            return res.status(error ? 500 : 404).json({ error: error ? 'Database error fetching order: ' + error.message : 'Order not found.' });
        }

        console.log(`Order found for ID: ${id}`);
        res.json(order);
    } catch (error) {
        console.error('=== GENERAL ERROR ===:', error.message, error.stack);
        res.status(500).json({ error: 'An unexpected error occurred while fetching order details.' });
    }
};

module.exports = {
    postLogin,
    postAdminCreateProduct,
    postAdminUpdateProduct,
    getDashboardStatsApi,
    getAdminOrdersApi,
    getAdminProductCategories,
    getAdminProductByIdApi,
    deleteAdminProduct,
    getAdminOrderDetailById
};
