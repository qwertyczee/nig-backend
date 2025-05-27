const { Request, Response } = require('express');
const { supabase } = require('../config/db');
const { createLemonSqueezyCheckout } = require('../services/lemonsqueezyService');

const createOrder = async (req, res) => {
  const body = req.body;
  const userId = req.user?.id || null;
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

    const billingAddress = body.billing_address;

    // 1. Nejprve vytvoř objednávku v DB (status awaiting_payment)
    const { data: newOrder, error: orderError } = await supabase
      .from('orders')
      .insert({
        user_id: userId,
        total_amount: totalPrice,
        shipping_address: body.shipping_address,
        billing_address: body.billing_address || body.shipping_address,
        status: 'awaiting_payment',
        payment_provider: 'lemonsqueezy',
        payment_intent_id: null,
      })
      .select()
      .single();

    if (orderError || !newOrder) {
      return res.status(500).json({ message: 'Failed to create order.', error: orderError?.message });
    }

    // 2. Použij order_id jako identifikátor pro LemonSqueezy
    const user = {
      id: newOrder.id,
      email: customerEmail,
      phone: billingAddress?.phone || '',
      name: billingAddress?.full_name || '',
      taxNumber: body.tax_number || '',
      discountCode: body.discount_code || '',
    };

    const address = {
      country: billingAddress?.country || '',
      postalCode: billingAddress?.postal_code || '',
      city: billingAddress?.city || '',
      street: billingAddress?.street || '',
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

const getMyOrders = async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ message: 'User not authenticated.' });
  }

  try {
    const { data: orders, error } = await supabase
      .from('orders')
      .select(`
        id,
        created_at,
        status,
        total_amount,
        payment_provider,
        payment_intent_id,
        shipping_address, 
        order_items (
          id,
          quantity,
          price_at_purchase,
          products (id, name, image_url)
        )
      `)
      // RLS policy "Users can view their own orders" will filter by auth.uid()
      // Adding explicit .eq('user_id', userId) is fine for clarity or if RLS isn't solely relied upon.
      .eq('user_id', userId) 
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(orders);
  } catch (error) {
    console.error('Error fetching orders:', error.message);
    res.status(500).json({ message: 'Error fetching orders', error: error.message });
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
        )
      `)
      .eq('id', id)
      // RLS will ensure the user owns this order or is admin.
      // For an extra check, you could add .eq('user_id', userId) if not admin.
      // However, relying on RLS is standard.
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
        // RLS policy "Users can cancel their own pending orders" (updated for 'awaiting_payment')
        // USING (auth.uid() = user_id AND status IN ('pending', 'awaiting_payment'))
        // WITH CHECK (status = 'cancelled')
        const { data, error, count } = await supabase
            .from('orders')
            .update({ status: 'cancelled' })
            .eq('id', orderId)
            // .eq('user_id', userId) // RLS handles this, but can be explicit
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
            if (error.code === 'PGRST116') { // 0 rows updated/returned
                // This means order not found, not owned, or not in a cancellable state ('pending' or 'awaiting_payment')
                // according to RLS. Let's find out why for a better message.
                const { data: existingOrder, error: fetchError } = await supabase
                    .from('orders')
                    .select('id, status, user_id')
                    .eq('id', orderId)
                    .maybeSingle();

                if (fetchError) { // Error fetching the order details
                    console.error('Error fetching existing order details during cancellation attempt:', fetchError.message);
                    return res.status(500).json({ message: 'Could not verify order status for cancellation.' });
                }
                if (!existingOrder) {
                    return res.status(404).json({ message: 'Order not found.' });
                }
                // At this point, RLS prevented the update.
                // If existingOrder.user_id !== userId, it's an auth issue (though RLS should prevent seeing it too).
                // More likely, the status is not 'pending' or 'awaiting_payment'.
                if (existingOrder.user_id !== userId) {
                     return res.status(403).json({ message: 'You are not authorized to cancel this order.' });
                }
                if (!['pending', 'awaiting_payment'].includes(existingOrder.status)) {
                     return res.status(400).json({ message: `Order is in '${existingOrder.status}' status and cannot be cancelled by the user.` });
                }
                // Default message if other specific checks don't catch it
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
  
  const getOrderBySessionToken = async (req, res) => {
    const { customerSessionToken } = req.params;
  
    if (!customerSessionToken) {
      return res.status(400).json({ message: 'Customer session token is required.' });
    }
  
    try {
      const orderDetails = await getPolarOrderDetailsBySessionToken(customerSessionToken);
  
      if (!orderDetails) {
        // This could mean the session was not found, or it was found but had no relevant order data.
        // The service layer might return null for a 404 or if the data structure isn't as expected.
        return res.status(404).json({ message: 'Order details not found for the provided session token.' });
      }
  
      // Potentially, you might want to look up your internal order using metadata from `orderDetails`
      // if Polar's response doesn't directly contain everything you need for the frontend.
      // For example, if `orderDetails.metadata.internal_order_id` exists:
      // const internalOrder = await supabase.from('orders').select('*').eq('id', orderDetails.metadata.internal_order_id).single();
      // Then combine `orderDetails` with `internalOrder` as needed.
  
      // For now, returning the direct response from Polar service.
      res.json(orderDetails);
  
    } catch (error) {
      console.error(`Error fetching order details by session token ${customerSessionToken}:`, error.message);
      // Check for specific error types if the service layer throws them (e.g., configuration error)
      if (error.message.includes('Polar integration is not configured')) {
          return res.status(503).json({ message: 'Payment service is currently unavailable.', error: error.message });
      }
      res.status(500).json({ message: 'Failed to retrieve order details.', error: error.message });
    }
  };
  
  module.exports = {
      createOrder,
      getMyOrders,
      getOrderById,
      cancelMyOrder,
      getOrderBySessionToken // Add the new controller function
  };