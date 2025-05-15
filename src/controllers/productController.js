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
  // === KONTROLNÍ LOG: Začátek funkce createProduct ===
  console.log('LOG: productController.ts: createProduct - FUNKCE ZAVOLÁNA.');
  console.log('LOG: productController.ts: createProduct - Request body:', JSON.stringify(req.body, null, 2));
  // =====================================================

  const { name, description, price, category, image_url, in_stock } = req.body;

  if (!name || price === undefined || parseFloat(price) < 0) {
    console.error('LOG: productController.ts: createProduct - Chyba: Jméno a nezáporná cena jsou povinné. Name:', name, 'Price:', price);
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
    console.log('LOG: productController.ts: createProduct - Pokus o vytvoření produktu v Supabase. Jméno:', productDataForSupabase.name);
    const { data, error: supabaseError } = await supabase
      .from('products')
      .insert([productDataForSupabase])
      .select()
      .single();

    if (supabaseError) {
      console.error('LOG: productController.ts: createProduct - Chyba při vytváření produktu v Supabase:', supabaseError.message);
      return res.status(500).json({ message: 'Error creating product in database', error: supabaseError.message });
    }
    newSupabaseProduct = data;
    console.log('LOG: productController.ts: createProduct - Produkt vytvořen v Supabase. ID:', newSupabaseProduct.id);

    // 2. Create product/price in Polar
    const polarOrganizationId = process.env.POLAR_ORGANIZATION_ID;
    if (!polarOrganizationId) {
      console.warn(`LOG: productController.ts: createProduct - POLAR_ORGANIZATION_ID není nastaveno. Přeskakuji vytváření produktu v Polar pro Supabase produkt ID: ${newSupabaseProduct.id}`);
      return res.status(201).json(newSupabaseProduct);
    }
    if (!polar) {
        console.error(`LOG: productController.ts: createProduct - Instance Polar SDK není dostupná. Přeskakuji vytváření produktu v Polar pro Supabase produkt ID: ${newSupabaseProduct.id}`);
        return res.status(201).json(newSupabaseProduct);
    }

    const priceInCents = Math.round(parseFloat(price) * 100);

    console.log(`LOG: productController.ts: createProduct - === VYTVÁŘENÍ PRODUKTU NA POLAR ===`);
    console.log(`LOG: productController.ts: createProduct - Pokus o vytvoření Polar produktu pro Supabase produkt ID: ${newSupabaseProduct.id}, Jméno: ${newSupabaseProduct.name}, Cena: ${priceInCents} centů`);

    const polarProductPayload = {
      name: newSupabaseProduct.name,
      description: newSupabaseProduct.description || undefined,
      organization_id: polarOrganizationId,
      type: 'individual',
      prices: [
        {
          price_currency: 'usd',
          price_amount: priceInCents,
        },
      ],
    };
    
    console.log('LOG: productController.ts: createProduct - Volání polar.products.create s payloadem:', JSON.stringify(polarProductPayload, null, 2));
    const polarResponse = await polar.products.create(polarProductPayload);

    if (!polarResponse || !polarResponse.ok) {
        const errorDetail = polarResponse ? JSON.stringify(polarResponse.error || polarResponse) : 'Neznámá chyba Polar SDK';
        console.error(`LOG: productController.ts: createProduct - !!! CHYBA PŘI VYTVÁŘENÍ PRODUKTU/CENY V POLAR pro Supabase produkt ID ${newSupabaseProduct.id}:`, errorDetail);
        console.log(`LOG: productController.ts: createProduct - Pokus o rollback vytvoření produktu v Supabase pro ID: ${newSupabaseProduct.id} kvůli chybě Polar.`);
        await supabase.from('products').delete().eq('id', newSupabaseProduct.id);
        console.log(`LOG: productController.ts: createProduct - Rollback DOKONČEN pro Supabase produkt ID: ${newSupabaseProduct.id}`);
        return res.status(502).json({ message: 'Failed to create product in payment provider. Database changes rolled back.', error: errorDetail });
    }

    const createdPolarProduct = polarResponse.value;
    console.log('LOG: productController.ts: createProduct - === PRODUKT NA POLAR ÚSPĚŠNĚ VYTVOŘEN (nebo odpověď přijata) ===');
    console.log('LOG: productController.ts: createProduct - Surová hodnota odpovědi od Polar:', JSON.stringify(createdPolarProduct, null, 2));

    if (!createdPolarProduct || !createdPolarProduct.id || !createdPolarProduct.prices || createdPolarProduct.prices.length === 0 || !createdPolarProduct.prices[0].id) {
      console.error(`LOG: productController.ts: createProduct - !!! Produkt v Polar byl vytvořen pro Supabase produkt ID ${newSupabaseProduct.id}, ale chybí ID produktu Polar nebo ID ceny. Polar odpověď:`, JSON.stringify(createdPolarProduct));
      console.log(`LOG: productController.ts: createProduct - Pokus o rollback vytvoření produktu v Supabase pro ID: ${newSupabaseProduct.id} kvůli chybějícímu Polar price ID.`);
      await supabase.from('products').delete().eq('id', newSupabaseProduct.id);
      console.log(`LOG: productController.ts: createProduct - Rollback DOKONČEN (kvůli chybějícímu Polar price ID) pro produkt ID: ${newSupabaseProduct.id}`);
      return res.status(502).json({ message: 'Product created in payment provider, but price details are missing. Database changes rolled back.' });
    }

    const polarPriceId = createdPolarProduct.prices[0].id;
    const polarProductId = createdPolarProduct.id; // Získání ID produktu Polar
    console.log(`LOG: productController.ts: createProduct - POLAR PRODUKT A CENA ÚSPĚŠNĚ VYTVOŘENY pro Supabase produkt ID ${newSupabaseProduct.id}.`);
    console.log(`LOG: productController.ts: createProduct -   >> Polar Product ID: ${polarProductId}`);
    console.log(`LOG: productController.ts: createProduct -   >> Polar Price ID: ${polarPriceId}`);

    // 3. Update Supabase product with Polar Price ID
    console.log(`LOG: productController.ts: createProduct - Pokus o aktualizaci Supabase produktu ID ${newSupabaseProduct.id} s Polar Price ID: ${polarPriceId}`);
    const { data: updatedSupabaseProduct, error: updateError } = await supabase
      .from('products')
      .update({ polar_price_id: polarPriceId })
      .eq('id', newSupabaseProduct.id)
      .select()
      .single();

    if (updateError) {
      console.error(`LOG: productController.ts: createProduct - !!! NEPODAŘILO SE aktualizovat Supabase produkt ${newSupabaseProduct.id} s Polar Price ID ${polarPriceId}:`, updateError.message);
      return res.status(201).json({
        ...newSupabaseProduct, // Vraťte stav produktu před pokusem o aktualizaci
        polar_product_id: polarProductId, // Zahrňte ID produktu Polar pro referenci
        polar_price_id: polarPriceId,     // Zahrňte ID ceny Polar pro referenci
        warning: `Produkt byl vytvořen v Supabase (ID: ${newSupabaseProduct.id}) a v Polar (Produkt ID: ${polarProductId}, Cena ID: ${polarPriceId}), ale nepodařilo se propojit Polar Price ID v databázi. Prosím, zkontrolujte manuálně.`
      });
    }

    console.log(`LOG: productController.ts: createProduct - Supabase produkt ID ${updatedSupabaseProduct.id} ÚSPĚŠNĚ aktualizován s Polar Price ID: ${polarPriceId}.`);
    res.status(201).json(updatedSupabaseProduct);

  } catch (error) {
    console.error('LOG: productController.ts: createProduct - === CELKOVÁ CHYBA V createProduct ===:', error.message, error.stack);
    if (newSupabaseProduct && newSupabaseProduct.id && !res.headersSent) {
        try {
            const { data: existing } = await supabase.from('products').select('id, polar_price_id').eq('id', newSupabaseProduct.id).single();
            if (existing && !existing.polar_price_id) {
                 console.warn(`LOG: productController.ts: createProduct - Generický error handler: Pokus o rollback Supabase produktu ${newSupabaseProduct.id} kvůli neošetřené chybě.`);
                 await supabase.from('products').delete().eq('id', newSupabaseProduct.id);
                 console.log(`LOG: productController.ts: createProduct - Generický error handler: Rollback DOKONČEN pro Supabase produkt ${newSupabaseProduct.id}.`);
            }
        } catch (rollbackError) {
            console.error(`LOG: productController.ts: createProduct - Generický error handler: NEPODAŘILO SE provést rollback Supabase produktu ${newSupabaseProduct.id}:`, rollbackError.message);
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