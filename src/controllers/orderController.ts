import { Request, Response } from 'express';
import { supabase } from '../config/db';
import { Order, OrderInput, OrderItemInput, OrderStatus } from '../types/orderTypes';
import { createPolarCheckoutSession } from '../services/polarService';

export const createOrder = async (req: Request, res: Response) => {
  // user_id will come from req.user populated by authMiddleware
  // Explicitly type req.body to include customer_email, as it's used for Polar
  const body = req.body as Omit<OrderInput, 'user_id'> & { customer_email?: string };
  const orderInput = body;
  // For guest checkout, userId can be null.
  // req.user might not exist if 'protect' middleware is removed for this route.
  const userId = req.user?.id || null;

  // User authentication check is removed as guests can order.

  if (!orderInput.items || orderInput.items.length === 0 || !orderInput.shipping_address) {
    return res.status(400).json({ message: 'Missing required fields: items and shipping_address are required.' });
  }

  // Extract email for Polar. Ensure it's provided by the frontend via customer_email.
  const customerEmail = orderInput.customer_email;
  if (!customerEmail) {
    return res.status(400).json({ message: 'Customer email (customer_email) is required for payment processing.' });
  }

  try {
    let calculatedTotalAmount = 0;
    // Store polar_price_id and quantity for Polar, and other details for DB
    // Store polar_price_id and quantity for Polar, and other details for DB
    const orderItemsData: { polarPriceId: string; quantity: number; dbProductId: string; price_at_purchase: number; name: string; }[] = [];

    // 1. Validate items and calculate total amount
    for (const item of orderInput.items) {
      if (item.quantity <= 0) {
        return res.status(400).json({ message: `Invalid quantity for product ${item.product_id}. Quantity must be positive.` });
      }
      const { data: product, error: productError } = await supabase
        .from('products')
        .select('id, price, name, in_stock, polar_price_id') // Fetch polar_price_id
        .eq('id', item.product_id)
        .single();

      if (productError || !product) {
        return res.status(404).json({ message: `Product with ID ${item.product_id} not found or error fetching it.` });
      }
      if (!product.polar_price_id) {
        // This product is not configured for sale via Polar
        return res.status(400).json({ message: `Product ${product.name} (ID: ${product.id}) is not configured for Polar payments (missing polar_price_id).` });
      }
      if (!product.in_stock) {
        return res.status(400).json({ message: `Product ${product.name} is out of stock.` });
      }
      // TODO: Implement inventory check if quantity exceeds available stock

      calculatedTotalAmount += product.price * item.quantity;
      orderItemsData.push({
        polarPriceId: product.polar_price_id,
        quantity: item.quantity,
        dbProductId: product.id,
        price_at_purchase: product.price,
        name: product.name,
      });
    }
    
    // Billing address for Polar from shipping address
    // Ensure shipping_address has country and postal_code
    const shippingAddress = orderInput.shipping_address as { country: string; postal_code?: string; [key: string]: any };
    if (!shippingAddress.country) {
        return res.status(400).json({ message: 'Shipping address country is required for payment processing.' });
    }

    let countryCodeForPolar = shippingAddress.country;
    if (shippingAddress.country.toLowerCase() === 'česká republika' || shippingAddress.country.toLowerCase() === 'czech republic') {
        countryCodeForPolar = 'CZ';
    }
    // Add more mappings if other country names are used and need conversion to alpha-2

    const billingAddressForPolar = {
        country: countryCodeForPolar,
        postal_code: shippingAddress.postal_code,
        // line1: shippingAddress.street, // Example if Polar needs more fields
        // city: shippingAddress.city,     // Example
    };

    // Use a temporary order identifier for Polar metadata, or a pre-generated UUID for idempotency if needed.
    const tempOrderIdForPolar = `order_${Date.now()}_${userId || 'guest'}`;

    // 2. Create Checkout Session with Polar
    const itemsForPolarPayload = orderItemsData.map(p => ({ priceId: p.polarPriceId, quantity: p.quantity }));
    console.log('DEBUG: Items being sent to Polar createPolarCheckoutSession:', JSON.stringify(itemsForPolarPayload, null, 2));

    const polarSessionInfo = await createPolarCheckoutSession(
        tempOrderIdForPolar,
        itemsForPolarPayload, // Corrected: Use orderItemsData and p.polarPriceId
        customerEmail,
        billingAddressForPolar
    );

    // 3. Create the order in your database
    const { data: newOrder, error: orderError } = await supabase
      .from('orders')
      .insert({
        user_id: userId,
        total_amount: calculatedTotalAmount,
        shipping_address: orderInput.shipping_address,
        billing_address: orderInput.billing_address || orderInput.shipping_address,
        status: 'awaiting_payment' as OrderStatus,
        payment_provider: 'polar',
        payment_intent_id: polarSessionInfo.polarSessionId,
      })
      .select()
      .single();

    if (orderError || !newOrder) {
      console.error('Error creating order in DB:', orderError?.message);
      return res.status(500).json({ message: 'Failed to create order after payment intent.', error: orderError?.message });
    }

    // 4. Create order items
    const itemsToInsert = orderItemsData.map(item => ({ // Corrected: Use orderItemsData
      product_id: item.dbProductId, // Corrected: Use item.dbProductId for your database
      quantity: item.quantity,
      price_at_purchase: item.price_at_purchase,
      // name: item.name, // The 'order_items' table in migration 002 does not have a 'name' column.
                         // If you added it later, uncomment this. For now, assuming it's not there.
      order_id: newOrder.id,
    }));

    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(itemsToInsert);

    if (itemsError) {
      console.error('Error creating order items:', itemsError.message);
      // Attempt to "rollback" by deleting the order. This is not a true transaction.
      // A database function (RPC) or more robust error handling (e.g., marking order as 'payment_failed' or 'system_error') would be better.
      // Also, consider cancelling the payment intent with Polar.
      await supabase.from('orders').delete().eq('id', newOrder.id);
      return res.status(500).json({ message: 'Failed to create order items, order rolled back.', error: itemsError.message });
    }

    // 5. Fetch the complete order with items to return
    // The 'newOrder' object from the insert doesn't include joined relations like order_items.
    const { data: completeOrder, error: fetchError } = await supabase
      .from('orders')
      .select(`
        *,
        order_items (
          *,
          products (id, name, image_url)
        )
      `)
      .eq('id', newOrder.id)
      .single();
    
    if (fetchError || !completeOrder) {
        console.error('Error fetching complete order after creation:', fetchError?.message);
        // Order and items were created, but fetching the full details failed.
        // Return the core order data and the checkout URL.
        return res.status(201).json({
            ...newOrder,
            order_items: itemsToInsert,
            checkoutUrl: polarSessionInfo.checkoutUrl // Add checkoutUrl to the response
        });
    }

    // Add checkoutUrl to the successful response
    res.status(201).json({
        ...completeOrder,
        checkoutUrl: polarSessionInfo.checkoutUrl
    });

  } catch (error: any) {
    console.error('Unexpected error creating order:', error.message);
    if (error.message.includes('payment intent')) { // Check if error came from polarService
        return res.status(502).json({ message: 'Payment provider error.', error: error.message });
    }
    res.status(500).json({ message: 'An unexpected error occurred during order creation.', error: error.message });
  }
};

export const getMyOrders = async (req: Request, res: Response) => {
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
  } catch (error: any) {
    console.error('Error fetching orders:', error.message);
    res.status(500).json({ message: 'Error fetching orders', error: error.message });
  }
};

export const getOrderById = async (req: Request, res: Response) => {
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
  } catch (error: any) {
    console.error('Error fetching order by ID:', error.message);
    res.status(500).json({ message: 'Error fetching order', error: error.message });
  }
};

export const cancelMyOrder = async (req: Request, res: Response) => {
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
            .update({ status: 'cancelled' as OrderStatus })
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
                if (!['pending', 'awaiting_payment'].includes(existingOrder.status as string)) {
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
    } catch (error: any) {
        console.error('Error cancelling order:', error.message);
        res.status(500).json({ message: 'Error cancelling order', error: error.message });
    }
};
