const { supabase } = require('../config/db');

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

module.exports = {
    getAllProducts,
    getProductById
};