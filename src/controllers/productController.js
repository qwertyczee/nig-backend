// controllers/productController.js
const { supabase } = require('../config/db');
const {
  createPolarProduct,
  createCheckoutSession
} = require('../services/polarService');

console.log('productController loaded');

const createProduct = async (req, res) => {
  console.log('→ createProduct endpoint hit with body:', req.body);
  const { name, description, price, category, image_url, in_stock } = req.body;

  // Validace
  if (!name || price == null || parseFloat(price) < 0) {
    console.warn('❌ Invalid input:', { name, price });
    return res.status(400).json({ message: 'Name and non-negative price are required.' });
  }

  let supaProduct;
  try {
    // 1) Uložíme do Supabase
    const payload = {
      name,
      description,
      price: parseFloat(price),
      category,
      image_url,
      in_stock: in_stock ?? true,
    };
    console.log('  • Inserting into Supabase:', payload);
    const { data, error: sbError } = await supabase
      .from('products')
      .insert([payload])
      .select()
      .single();
    if (sbError) throw sbError;
    supaProduct = data;
    console.log('  ✔️ Supabase product created:', supaProduct);

    // 2) Pokud máme organisationId, vytvoříme Polar produkt
    const orgId = process.env.POLAR_ORGANIZATION_ID;
    if (!orgId) {
      console.warn('⚠️ POLAR_ORGANIZATION_ID missing — skipping Polar creation.');
      return res.status(201).json(supaProduct);
    }

    const priceCents = Math.round(parseFloat(price) * 100);
    console.log('  • Creating Polar product for Supabase ID:', supaProduct.id);

    const polarProd = await createPolarProduct({
      name: supaProduct.name,
      description: supaProduct.description,
      organizationId: orgId,
      priceAmount: priceCents,
      currency: process.env.CURRENCY || 'usd'
    });

    // 3) Uložíme polar_price_id zpět do Supabase
    const { data: updated, error: updErr } = await supabase
      .from('products')
      .update({ polar_price_id: polarProd.prices[0].id })
      .eq('id', supaProduct.id)
      .select()
      .single();
    if (updErr) throw updErr;
    console.log('  ✔️ Supabase product updated with Polar price ID:', updated);

    // 4) Vytvoříme testovací checkout session
    console.log('  • Creating test checkout session...');
    const checkout = await createCheckoutSession({
      productId: polarProd.id,
      amount: priceCents,
      customerEmail: 'test@example.com',
      billingAddress: { country: 'CZ', postalCode: '11000' },
      metadata: { supa_id: supaProduct.id }
    });
    console.log('  ✔️ Test checkout URL:', checkout.url);

    return res.status(201).json({ product: updated, testCheckoutUrl: checkout.url });
  } catch (err) {
    console.error('❌ createProduct failed:', err.message);
    // Rollback Supabase if Polar failed
    if (supaProduct && !res.headersSent) {
      console.log('  • Rolling back Supabase product ID:', supaProduct.id);
      await supabase.from('products').delete().eq('id', supaProduct.id);
    }
    return res.status(500).json({ message: 'Error creating product', error: err.message });
  }
};

module.exports = {
    getAllProducts,
    getProductById,
    createProduct,
    updateProduct,
    deleteProduct
};