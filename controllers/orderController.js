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

    // 1. Create the order first to get the order_id
    const { data: newOrder, error: orderError } = await supabase
      .from('orders')
      .insert({
        user_id: customerEmail,
        total_amount: totalPrice,
        status: 'awaiting_payment',
        // shipping_address_id and billing_address_id will be added after creating addresses
      })
      .select()
      .single();

    if (orderError || !newOrder) {
      return res.status(500).json({ message: 'Failed to create order.', error: orderError?.message });
    }

    // Get the new order ID
    const orderId = newOrder.id;

    // 2. Insert shipping address with the new order_id
    const { data: newShippingAddress, error: shippingAddressError } = await supabase
      .from('shipping_addresses')
      .insert({ ...shippingAddress, order_id: orderId })
      .select()
      .single();

    if (shippingAddressError || !newShippingAddress) {
      // Consider rolling back order creation here if shipping address creation fails
      // (Optional but recommended for data consistency)
      return res.status(500).json({ message: 'Failed to create shipping address.', error: shippingAddressError?.message });
    }

    let newBillingAddress = null;
    let billingAddressId = null;

    // 3. Insert billing address if provided, with the new order_id
    if (billingAddress) {
      const { data: insertedBillingAddress, error: billingAddressError } = await supabase
        .from('billing_addresses')
        .insert({ ...billingAddress, order_id: orderId })
        .select()
        .single();

      if (billingAddressError || !insertedBillingAddress) {
        // Consider rolling back order and shipping address creation here if billing fails
        return res.status(500).json({ message: 'Failed to create billing address.', error: billingAddressError?.message });
      }
      newBillingAddress = insertedBillingAddress;
      billingAddressId = newBillingAddress.id;
    } else {
      // If no billing address is provided, set billing_address_id to null
      billingAddressId = null;
    }

    // 4. Insert order items with the new order_id
    const itemsToInsert = body.items.map(item => ({
      order_id: orderId,
      product_id: item.product_id,
      quantity: item.quantity,
      price_at_purchase: cartItems.find(p => p.id === item.product_id)?.price || 0, // Store the price at the time of purchase
    }));

    const { error: orderItemsError } = await supabase
      .from('order_items')
      .insert(itemsToInsert);

    if (orderItemsError) {
      console.error('Error inserting order items:', orderItemsError.message);
      // Consider rolling back order and address creations here if item insertion fails
      return res.status(500).json({ message: 'Failed to create order items.', error: orderItemsError.message });
    }

    // 4. Update the order with the foreign keys to addresses
    const { data: updatedOrder, error: updateOrderError } = await supabase
      .from('orders')
      .update({
        shipping_address_id: newShippingAddress.id,
        billing_address_id: billingAddressId,
      })
      .eq('id', orderId)
      .select(`
        *,
        order_items (
          *,
          products (id, name, main_image_url, description)
        ),
        shipping_address_id (*),
        billing_address_id (*)
      `)
      .single();

    if (updateOrderError || !updatedOrder) {
       // Consider rolling back order and address creations here if update fails
      return res.status(500).json({ message: 'Failed to update order with address IDs.', error: updateOrderError?.message });
    }

    // 5. Use order_id for LemonSqueezy (use shipping address for LemonSqueezy details as billing might be the same)
    const user = {
      id: updatedOrder.id,
      email: customerEmail,
      phone: newShippingAddress?.phone || '', // Use shipping address phone
      name: newShippingAddress?.full_name || '', // Use shipping address full_name
      taxNumber: body.tax_number || '',
      discountCode: body.discount_code || '',
    };

    const address = {
      country: newShippingAddress?.country || '', // Use shipping address country
      postalCode: newShippingAddress?.postal_code || '', // Use shipping address postal_code
      city: newShippingAddress?.city || '', // Use shipping address city
      street: newShippingAddress?.street || '', // Use shipping address street
    };

    const checkoutUrl = await createLemonSqueezyCheckout({ 
      user, 
      address,
      discountCode: user.discountCode,
      totalPriceInCents 
    });

    res.status(201).json({ ...updatedOrder, checkoutUrl });

  } catch (error) {
    console.error('Error during order creation process:', error.message);
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
          products (id, name, main_image_url, description)
        ),
        shipping_address_id (*),
        billing_address_id (*)
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
            .select('*, shipping_address_id (*), billing_address_id (*)', { count: 'exact', head: true });

        if (searchTerm) {
            // Adjust search to potentially search within address fields or order user_id
            // For now, keeping it simple and searching user_id
            query = query.ilike('user_id', `%${searchTerm}%`);
        }

        const { count = 0, error: countError } = await query;

        // Reset query for fetching data, applying the same search filter
        let dataQuery = supabase
            .from('orders')
            .select('*, shipping_address_id (*), billing_address_id (*), order_items (*, products (id, name, main_image_url, description))') // Include addresses and product details in select
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