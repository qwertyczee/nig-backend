import { Request, Response } from 'express';
import { supabase } from '../config/db'; // Import Supabase client

console.log('LOG: productController.ts: Controller file loaded.');

export const getAllProducts = async (req, res) => {
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

export const getProductById = async (req, res) => {
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

export const createProduct = async (req, res) => {
  try {
    const { name, description, price, category, image_url, in_stock } = req.body;

    if (!name || price === undefined || price < 0) {
      return res.status(400).json({ message: 'Name and a non-negative price are required.' });
    }

    const newProduct = {
      name,
      description,
      price,
      category,
      image_url,
      in_stock: in_stock === undefined ? true : in_stock, // Default in_stock to true if not provided
    };

    const { data, error } = await supabase
      .from('products')
      .insert([newProduct])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    console.error('Error creating product:', error.message);
    // Check for specific Supabase/Postgres errors if needed, e.g., unique constraint violation
    res.status(500).json({ message: 'Error creating product', error: error.message });
  }
};

export const updateProduct = async (req, res) => {
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

export const deleteProduct = async (req, res) => {
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