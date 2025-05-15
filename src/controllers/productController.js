const { Request, Response } = require('express');
const { supabase } = require('../config/db'); // Import Supabase client
const { polar } = require('../services/polarService'); // Import Polar SDK instance

console.log('LOG: productController.ts: Controller file loaded.');

const getAllProducts = async (req, res) => {
  console.log('LOG: productController.ts: getAllProducts controller function CALLED.');
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('LOG: productController.ts: getAllProducts - Supabase error:', error.message);
      throw error;
    }
    console.log('LOG: productController.ts: getAllProducts - Successfully fetched products. Count:', data?.length);
    res.json(data);
  } catch (error) {
    console.error('LOG: productController.ts: getAllProducts - Catch block error:', error.message);
    res.status(500).json({ message: 'Error fetching products', error: error.message });
  }
};

const getProductById = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .single(); // .single() expects exactly one row or throws error

    if (error) {
      if (error.code === 'PGRST116') { // PostgREST error for "Fetched result consists of 0 rows"
        return res.status(404).json({ message: 'Product not found' });
      }
      throw error;
    }
    
    if (!data) { // Should be caught by .single() error handling, but as a fallback
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json(data);
  } catch (error) {
    console.error('Error fetching product by ID:', error.message);
    res.status(500).json({ message: 'Error fetching product', error: error.message });
  }
};

const createProduct = async (req, res) => {
  const { name, description, price, category, image_url, in_stock } = req.body;

  if (!name || price === undefined || parseFloat(price) < 0) {
    return res.status(400).json({ message: 'Name and a non-negative price are required.' });
  }

  const productDataForSupabase = {
    name,
    description,
    price: parseFloat(price),
    category,
    image_url,
    in_stock: in_stock === undefined ? true : in_stock,
  };

  let newSupabaseProduct;

  try {
    // 1. Create product in Supabase
    const { data, error: supabaseError } = await supabase
      .from('products')
      .insert([productDataForSupabase])
      .select()
      .single();

    if (supabaseError) {
      console.error('Error creating product in Supabase:', supabaseError.message);
      return res.status(500).json({ message: 'Error creating product in database', error: supabaseError.message });
    }
    newSupabaseProduct = data;
    console.log('Product created in Supabase:', newSupabaseProduct.id);

    // 2. Create product/price in Polar
    const polarOrganizationId = process.env.POLAR_ORGANIZATION_ID;
    if (!polarOrganizationId) {
      console.warn('POLAR_ORGANIZATION_ID not set. Skipping Polar product creation. Product will not be purchasable via Polar.');
      // Return the Supabase product without Polar ID
      return res.status(201).json(newSupabaseProduct);
    }
    if (!polar) {
        console.error('Polar SDK instance not available. Skipping Polar product creation.');
        return res.status(201).json(newSupabaseProduct);
    }

    const priceInCents = Math.round(parseFloat(price) * 100); // Ensure price is in cents

    console.log(`Attempting to create Polar product for: ${name}, Price: ${priceInCents} cents`);

    const polarProductPayload = {
      name: newSupabaseProduct.name,
      description: newSupabaseProduct.description || undefined, // Optional
      organization_id: polarOrganizationId,
      prices: [
        {
          // This structure aligns with ProductPriceFixedCreate
          price_currency: 'usd', // TODO: Make this configurable or derive from product
          price_amount: priceInCents,
        },
      ],
      // recurring_interval is omitted for one-time products
    };
    
    const polarResponse = await polar.products.create(polarProductPayload);

    if (!polarResponse || !polarResponse.ok) {
        const errorDetail = polarResponse ? JSON.stringify(polarResponse.error || polarResponse) : 'Unknown Polar SDK error';
        console.error('Error creating product/price in Polar:', errorDetail);
        // Rollback Supabase product creation
        await supabase.from('products').delete().eq('id', newSupabaseProduct.id);
        console.log('Rolled back Supabase product creation for ID:', newSupabaseProduct.id);
        return res.status(502).json({ message: 'Failed to create product in payment provider. Database changes rolled back.', error: errorDetail });
    }

    const createdPolarProduct = polarResponse.value;
    if (!createdPolarProduct.prices || createdPolarProduct.prices.length === 0 || !createdPolarProduct.prices[0].id) {
      console.error('Polar product created, but price ID is missing:', JSON.stringify(createdPolarProduct));
      // Rollback Supabase product creation as we can't link it
      await supabase.from('products').delete().eq('id', newSupabaseProduct.id);
      console.log('Rolled back Supabase product creation due to missing Polar price ID for product ID:', newSupabaseProduct.id);
      return res.status(502).json({ message: 'Product created in payment provider, but price details are missing. Database changes rolled back.' });
    }

    const polarPriceId = createdPolarProduct.prices[0].id;
    console.log(`Polar product and price created. Polar Product ID: ${createdPolarProduct.id}, Polar Price ID: ${polarPriceId}`);

    // 3. Update Supabase product with Polar Price ID
    const { data: updatedSupabaseProduct, error: updateError } = await supabase
      .from('products')
      .update({ polar_price_id: polarPriceId })
      .eq('id', newSupabaseProduct.id)
      .select()
      .single();

    if (updateError) {
      console.error(`Failed to update Supabase product ${newSupabaseProduct.id} with Polar price ID ${polarPriceId}:`, updateError.message);
      // Product exists in Supabase & Polar, but link failed. Critical inconsistency.
      // For now, return the original Supabase product with a warning about the missing link.
      // A more robust system might queue this for retry or manual admin intervention.
      return res.status(201).json({
        ...newSupabaseProduct,
        warning: `Product created, and Polar price created (${polarPriceId}), but failed to link them in the database. Please check manually.`
      });
    }

    console.log('Supabase product updated with Polar Price ID:', updatedSupabaseProduct.id);
    res.status(201).json(updatedSupabaseProduct);

  } catch (error) {
    console.error('Overall error in createProduct:', error.message, error.stack);
    // If newSupabaseProduct was created but something failed afterwards (and not rolled back yet)
    // This is a generic catch-all; specific rollbacks should happen closer to the failure point.
    if (newSupabaseProduct && newSupabaseProduct.id && !res.headersSent) {
        // Check if a response has already been sent to avoid crashing
        // This is a last resort cleanup attempt.
        try {
            const { data: existing } = await supabase.from('products').select('id, polar_price_id').eq('id', newSupabaseProduct.id).single();
            if (existing && !existing.polar_price_id) { // Only delete if it wasn't fully processed with Polar
                 console.warn(`Generic error handler: Attempting to rollback Supabase product ${newSupabaseProduct.id} due to unhandled error in createProduct.`);
                 await supabase.from('products').delete().eq('id', newSupabaseProduct.id);
            }
        } catch (rollbackError) {
            console.error(`Generic error handler: Failed to rollback Supabase product ${newSupabaseProduct.id}:`, rollbackError.message);
        }
    }
    if (!res.headersSent) {
        res.status(500).json({ message: 'Error creating product', error: error.message });
    }
  }
};

const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body; // Use Partial as not all fields might be updated

    // Ensure price, if provided, is not negative
    if (updates.price !== undefined && updates.price < 0) {
      return res.status(400).json({ message: 'Price cannot be negative.' });
    }
    
    // Remove id, created_at, updated_at from updates if they exist, as they shouldn't be directly updated by client
    delete updates.id;
    delete updates.created_at;
    delete updates.updated_at;


    const { data, error, count } = await supabase
      .from('products')
      .update(updates)
      .eq('id', id)
      .select()
      .single(); // Expect one row to be updated and returned

    if (error) {
        if (error.code === 'PGRST116') { // 0 rows updated/returned
        return res.status(404).json({ message: 'Product not found or no changes made' });
      }
      throw error;
    }
    
    if (count === 0 || !data) { // Should be caught by .single() error handling
          return res.status(404).json({ message: 'Product not found or no changes made' });
    }

    res.json(data);
  } catch (error) {
    console.error('Error updating product:', error.message);
    res.status(500).json({ message: 'Error updating product', error: error.message });
  }
};

const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { error, count } = await supabase
      .from('products')
      .delete()
      .eq('id', id);

    if (error) throw error;

    if (count === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.status(204).send(); // No content, successful deletion
  } catch (error) {
    console.error('Error deleting product:', error.message);
    res.status(500).json({ message: 'Error deleting product', error: error.message });
  }
};

module.exports = {
    getAllProducts,
    getProductById,
    createProduct,
    updateProduct,
    deleteProduct
};