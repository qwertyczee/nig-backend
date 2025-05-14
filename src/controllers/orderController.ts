import { Request, Response } from 'express';
import { supabase } from '../config/db';
import { Order, OrderInput, OrderItemInput, OrderStatus } from '../types/orderTypes';
import { createPolarPaymentIntent } from '../services/polarService';

export const createOrder = async (req: Request, res: Response) => {
  // user_id will come from req.user populated by authMiddleware
  const orderInput = req.body as Omit<OrderInput, 'user_id'>; 
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'User not authenticated.' });
  }

  if (!orderInput.items || orderInput.items.length === 0 || !orderInput.shipping_address) {
    return res.status(400).json({ message: 'Missing required fields: items and shipping_address are required.' });
  }

  try {
    let calculatedTotalAmount = 0;
    const orderItemsProductData: { product_id: string; quantity: number; price_at_purchase: number }[] = [];

    // 1. Validate items and calculate total amount
    for (const item of orderInput.items) {
      if (item.quantity <= 0) {
        return res.status(400).json({ message: `Invalid quantity for product ${item.product_id}. Quantity must be positive.` });
      }
      const { data: product, error: productError } = await supabase
        .from('products')
        .select('id, price, name, in_stock')
        .eq('id', item.product_id)
        .single();

      if (productError || !product) {
        return res.status(404).json({ message: `Product with ID ${item.product_id} not found or error fetching it.` });
      }
      if (!product.in_stock) {
        return res.status(400).json({ message: `Product ${product.name} is out of stock.` });
      }
      // TODO: Implement inventory check if quantity exceeds available stock

      calculatedTotalAmount += product.price * item.quantity;
      orderItemsProductData.push({
        product_id: product.id,
        quantity: item.quantity,
        price_at_purchase: product.price,
      });
    }
    
    // Ensure total amount is in cents for most payment processors
    const totalAmountInCents = Math.round(calculatedTotalAmount * 100);

    // Use a temporary order identifier for Polar, or a pre-generated UUID for idempotency if needed.
    // For simplicity, a timestamp-based one is used here. A proper UUID is better for production.
    const tempOrderIdForPolar = `order_${Date.now()}`; 

    // 2. Create Payment Intent with Polar
    const paymentIntentInfo = await createPolarPaymentIntent(tempOrderIdForPolar, totalAmountInCents, 'usd');

    // 3. Create the order in your database
    const { data: newOrder, error: orderError } = await supabase
      .from('orders')
      .insert({
        user_id: userId,
        total_amount: calculatedTotalAmount, // Store in your standard currency unit
        shipping_address: orderInput.shipping_address,
        billing_address: orderInput.billing_address || orderInput.shipping_address,
        status: 'awaiting_payment' as OrderStatus, // Initial status
        payment_provider: 'polar',
        payment_intent_id: paymentIntentInfo.paymentIntentId,
        payment_client_secret: paymentIntentInfo.clientSecret,
      })
      .select()
      .single();

    if (orderError || !newOrder) {
      console.error('Error creating order in DB:', orderError?.message);
      // TODO: Potentially attempt to cancel the payment intent with Polar if order creation fails.
      // This requires a `cancelPolarPaymentIntent` function in polarService.ts.
      return res.status(500).json({ message: 'Failed to create order after payment intent.', error: orderError?.message });
    }

    // 4. Create order items
    const itemsToInsert = orderItemsProductData.map(item => ({
      ...item,
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
        // Return the core order data and payment client secret.
        return res.status(201).json({ 
            ...newOrder, // Contains payment_client_secret from the insert
            order_items: itemsToInsert, // Use the data we have for items
        });
    }

    // Ensure payment_client_secret is part of the response.
    // If `completeOrder` comes directly from a select that might not include it (if not explicitly selected),
    // merge it from `newOrder` or `paymentIntentInfo`.
    // However, `newOrder` from the `.insert().select().single()` should contain all columns of the 'orders' table.
    res.status(201).json(completeOrder); // `completeOrder` should include payment_client_secret as it's a column in 'orders'

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
