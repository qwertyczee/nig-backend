const { supabase } = require('../config/db');
const { createLemonSqueezyCheckout } = require('../services/lemonsqueezyService');

const createOrder = async (req, res) => {
  const body = req.body;
  if (!body.shipping_address) {
    return res.status(400).json({ message: 'Missing required field: shipping_address.' });
  }
  const customerEmail = body.customer_email;
  if (!customerEmail) {
    return res.status(400).json({ message: 'Customer email (customer_email) is required for payment processing.' });
  }
  try {
    // Get all products from the cart
    const { data: cartItems, error: cartError } = await supabase
      .from('products')
      .select('id, price')
      .in('id', body.items.map(item => item.product_id));

    if (cartError) {
      throw new Error('Failed to fetch products from cart');
    }

    // Calculate total price
    let totalPrice = 0;
    body.items.forEach(cartItem => {
      const product = cartItems.find(p => p.id === cartItem.product_id);
      if (product) {
        totalPrice += product.price * cartItem.quantity;
      }
    });

    // Convert to cents for LemonSqueezy
    const totalPriceInCents = Math.round(totalPrice * 100);

    const shippingAddress = body.shipping_address;
    const billingAddress = body.billing_address;

    // 1. Insert shipping address
    const { data: newShippingAddress, error: shippingAddressError } = await supabase
      .from('shipping_addresses')
      .insert(shippingAddress)
      .select()
      .single();

    if (shippingAddressError || !newShippingAddress) {
      return res.status(500).json({ message: 'Failed to create shipping address.', error: shippingAddressError?.message });
    }

    let newBillingAddress = null;
    let billingAddressId = null;

    // 2. Insert billing address if different from shipping
    if (billingAddress && JSON.stringify(shippingAddress) !== JSON.stringify(billingAddress)) {
      const { data: insertedBillingAddress, error: billingAddressError } = await supabase
        .from('billing_addresses')
        .insert(billingAddress)
        .select()
        .single();

      if (billingAddressError || !insertedBillingAddress) {
        // Consider rolling back shipping address creation here if billing fails
        return res.status(500).json({ message: 'Failed to create billing address.', error: billingAddressError?.message });
      }
      newBillingAddress = insertedBillingAddress;
      billingAddressId = newBillingAddress.id;
    } else {
      // If billing is same as shipping, use shipping address ID
      billingAddressId = newShippingAddress.id;
    }

    // 3. Create the order with foreign keys to addresses
    const { data: newOrder, error: orderError } = await supabase
      .from('orders')
      .insert({
        user_id: customerEmail,
        total_amount: totalPrice,
        shipping_address_id: newShippingAddress.id,
        billing_address_id: billingAddressId,
        status: 'awaiting_payment',
      })
      .select()
      .single();

    if (orderError || !newOrder) {
      // Consider rolling back address creations here if order fails
      return res.status(500).json({ message: 'Failed to create order.', error: orderError?.message });
    }

    // 4. Use order_id for LemonSqueezy (use shipping address for LemonSqueezy details as billing might be the same)
    const user = {
      id: newOrder.id,
      email: customerEmail,
      phone: newShippingAddress?.phone || '',
      name: newShippingAddress?.full_name || '',
      taxNumber: body.tax_number || '',
      discountCode: body.discount_code || '',
    };

    const address = {
      country: newShippingAddress?.country || '',
      postalCode: newShippingAddress?.postal_code || '',
      city: newShippingAddress?.city || '',
      street: newShippingAddress?.street || '',
    };

    const checkoutUrl = await createLemonSqueezyCheckout({ 
      user, 
      address,
      discountCode: user.discountCode,
      totalPriceInCents 
    });

    res.status(201).json({ ...newOrder, checkoutUrl });
  } catch (error) {
    res.status(500).json({ message: 'An unexpected error occurred during order creation.', error: error.message });
  }
};

const getOrderById = async (req, res) => {
  const { id } = req.params;
  const userId = req.user?.id; 

  if (!userId) {
    return res.status(401).json({ message: 'User not authenticated.' });
  }

  try {
    const { data: order, error } = await supabase
      .from('orders')
      .select(`
        *,
        order_items (
          *,
          products (id, name, image_url, description)
        ),
        shipping_addresses (*),
        billing_addresses (*)
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') { // PostgREST error for "Fetched result consists of 0 rows"
        return res.status(404).json({ message: 'Order not found or you are not authorized to view it.' });
      }
      throw error;
    }
    // No need for `if (!order)` check as `.single()` would have thrown PGRST116 if not found.
    res.json(order);
  } catch (error) {
    console.error('Error fetching order by ID:', error.message);
    res.status(500).json({ message: 'Error fetching order', error: error.message });
  }
};

const cancelMyOrder = async (req, res) => {
    const { id: orderId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
        return res.status(401).json({ message: 'User not authenticated.' });
    }

    try {
        const { data, error, count } = await supabase
            .from('orders')
            .update({ status: 'cancelled' })
            .eq('id', orderId)
            .select(`
                *,
                order_items (
                    id,
                    quantity,
                    price_at_purchase,
                    products (id, name, image_url)
                )
            `)
            .single(); // Expects one row to be updated and returned

        if (error) {
            if (error.code === 'PGRST116') {
                const { data: existingOrder, error: fetchError } = await supabase
                    .from('orders')
                    .select('id, status, user_id')
                    .eq('id', orderId)
                    .maybeSingle();

                if (fetchError) {
                    console.error('Error fetching existing order details during cancellation attempt:', fetchError.message);
                    return res.status(500).json({ message: 'Could not verify order status for cancellation.' });
                }
                if (!existingOrder) {
                    return res.status(404).json({ message: 'Order not found.' });
                }
                if (existingOrder.user_id !== userId) {
                    return res.status(403).json({ message: 'You are not authorized to cancel this order.' });
                }
                if (!['pending', 'awaiting_payment'].includes(existingOrder.status)) {
                    return res.status(400).json({ message: `Order is in '${existingOrder.status}' status and cannot be cancelled by the user.` });
                }
                return res.status(403).json({ message: 'Order cannot be cancelled. It may not exist, not belong to you, or not be in a cancellable state.' });
            }
            throw error; // Other unexpected Supabase errors
        }
        
        // `.single()` would throw PGRST116 if count is 0, so this check is somewhat redundant if error handling above is complete.
        // However, it's a good safeguard.
        if (count === 0 || !data) { 
            return res.status(404).json({ message: 'Order not found, not in a cancellable state, or not authorized.' });
        }

        res.json(data); // Return the updated (cancelled) order
    } catch (error) {
        console.error('Error cancelling order:', error.message);
        res.status(500).json({ message: 'Error cancelling order', error: error.message });
    }
  };
  
const getAdminOrdersApi = async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;
        const from = (page - 1) * limit;
        const to = from + limit - 1;
        const searchTerm = req.query.search;

        let query = supabase
            .from('orders')
            .select('*, shipping_addresses (*), billing_addresses (*)', { count: 'exact', head: true });

        if (searchTerm) {
            // Adjust search to potentially search within address fields or order user_id
            // For now, keeping it simple and searching user_id
            query = query.ilike('user_id', `%${searchTerm}%`);
        }

        const { count = 0, error: countError } = await query;

        // Reset query for fetching data, applying the same search filter
        let dataQuery = supabase
            .from('orders')
            .select('*, shipping_addresses (*), billing_addresses (*)') // Include addresses in select
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

module.exports = {
    createOrder,
    getOrderById,
    cancelMyOrder,
    getAdminOrdersApi,
};