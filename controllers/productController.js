const { supabase } = require('../config/db');


/**
 * Retrieves all products from the database.
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 */
const getAllProducts = async (req, res) => {
  console.log('getAllProducts controller function CALLED.');
  try {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, price, description, main_image_url, sub_image_urls, is_18_plus, category, in_stock, created_at, updated_at')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('getAllProducts - Supabase error:', error.message);
      throw error;
    }
    console.log('getAllProducts - Successfully fetched products. Count:', data?.length);

    res.json(data);
  } catch (error) {
    console.error('getAllProducts - Catch block error:', error.message);
    res.status(500).json({ message: 'Error fetching products', error: error.message });
  }
};

/**
 * Retrieves a single product by its ID from the database.
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 */
const getProductById = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('products')
      .select('id, name, price, description, main_image_url, sub_image_urls, is_18_plus, category, in_stock, created_at, updated_at')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ message: 'Product not found' });
      }
      throw error;
    }
    
    if (!data) {
      return res.status(404).json({ message: 'Product not found' });
    }
    
    res.json(data);
  } catch (error) {
    console.error('Error fetching product by ID:', error.message);
    res.status(500).json({ message: 'Error fetching product', error: error.message });
  }
};

module.exports = {
    getAllProducts,
    getProductById
};