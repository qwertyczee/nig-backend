const { Request, Response } = require('express');
const { supabase } = require('../config/db');
const { verifyPolarWebhookSignature } = require('../services/polarService'); // Import the verification function

// Note: The Polar SDK instance might not be needed here if webhooks are just events
// and don't require further SDK calls for verification (depends on Polar's design).
// const polar = new Polar(); // Removed as verifyPolarWebhookSignature is standalone

const handlePolarWebhook = async (req, res) => {
  const signatureHeader = req.headers['polar-signature']; // Adjust if Polar uses a different header
  const webhookSecret = process.env.POLAR_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('Webhook secret (POLAR_WEBHOOK_SECRET) is not configured on the server.');
    return res.status(500).send('Webhook secret not configured.');
  }

  // req.body should be a Buffer here because we used express.raw() for this route in index.ts
  if (!(req.body instanceof Buffer)) {
    console.error('Raw request body not available for webhook verification. Ensure express.raw() is used for this route.');
    return res.status(400).send('Webhook error: Raw body not available.');
  }
  const rawBody = req.body;

  if (!verifyPolarWebhookSignature(rawBody, signatureHeader, webhookSecret)) {
    console.warn('Polar webhook signature verification failed.');
    return res.status(403).send('Webhook signature verification failed.');
  }

  // If signature is verified, parse the JSON payload from the raw body
  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch (e) {
    console.error('Error parsing webhook JSON payload:', e.message);
    return res.status(400).send('Webhook error: Invalid JSON payload.');
  }
  
  console.log('Polar webhook event received and signature verified:', event.type, event.data?.id || 'N/A');

  try {
    // Process the event based on its type
    if (event.type === 'order.paid') {
      const orderData = event.data;
      const internalOrderId = orderData?.metadata?.internal_order_id; // Your internal order ID
      const polarOrderId = orderData?.id; // Polar's unique ID for this order event

      if (internalOrderId && orderData?.status === 'paid') {
        console.log(`Processing 'order.paid' for internal order: ${internalOrderId}, Polar Order ID: ${polarOrderId}`);
        const { error } = await supabase
          .from('orders')
          .update({
            status: 'processing', // Or 'completed', 'paid', etc.
            payment_intent_id: polarOrderId, // Store Polar's order ID as reference
            // You might add a specific 'polar_order_id' column if 'payment_intent_id' is used for other purposes.
          })
          .eq('id', internalOrderId)
          .eq('status', 'awaiting_payment'); // Ensure we only update orders awaiting payment

        if (error) {
          console.error(`Error updating order ${internalOrderId} to paid:`, error.message);
          // Potentially retry or log for manual intervention
          return res.status(500).send('Error updating order status in database.');
        }
        console.log(`Order ${internalOrderId} status updated to processing/paid.`);
        // TODO: Implement any post-payment success logic (e.g., send confirmation email, trigger fulfillment)
      } else {
        console.warn(`Webhook event 'order.paid' received, but internal_order_id missing or payment not successful. Metadata:`, orderData?.metadata, `Status: ${orderData?.status}`);
      }
    } else if (event.type === 'checkout.updated') {
      const checkoutData = event.data;
      const internalOrderId = checkoutData?.metadata?.internal_order_id;
      const polarCheckoutId = checkoutData?.id;

      if (internalOrderId) {
        console.log(`Processing 'checkout.updated' for internal order: ${internalOrderId}, Polar Checkout ID: ${polarCheckoutId}, Status: ${checkoutData.status}`);
        
        let newStatus = null;
        let logMessage = '';

        // Determine new status based on Polar checkout status
        // Note: Polar's 'checkout.updated' might have various statuses.
        // 'failed', 'expired', 'canceled' are common terminal states for checkouts.
        // The provided schema only showed "open", so confirm exact values from Polar docs if issues arise.
        if (checkoutData.status === 'failed') { // Hypothetical status, confirm with Polar
          newStatus = 'payment_failed';
          logMessage = `Order ${internalOrderId} status updated to payment_failed due to Polar checkout status 'failed'.`;
        } else if (checkoutData.status === 'expired' || checkoutData.status === 'canceled') { // Hypothetical statuses
          newStatus = 'cancelled';
          logMessage = `Order ${internalOrderId} status updated to cancelled due to Polar checkout status '${checkoutData.status}'.`;
        }
        // Add other status mappings here if needed, e.g., 'open', 'processing_payment' etc.
        // else if (checkoutData.status === 'open') { /* Potentially log or handle */ }
        
        if (newStatus) {
          const { error } = await supabase
            .from('orders')
            .update({ status: newStatus })
            .eq('id', internalOrderId)
            .eq('status', 'awaiting_payment'); // Only update if it was awaiting payment

          if (error) {
            console.error(`Error updating order ${internalOrderId} to ${newStatus}:`, error.message);
          } else {
            console.log(logMessage);
          }
        } else {
          console.log(`No specific status update for order ${internalOrderId} based on checkout status: ${checkoutData.status}`);
        }
      } else {
        console.warn(`Webhook event 'checkout.updated' received, but internal_order_id missing. Metadata:`, checkoutData?.metadata);
      }
    }
    // Add more event types as needed (e.g., 'order.refunded')

    res.status(200).send('Webhook processed.');
  } catch (error) {
    console.error('Error processing Polar webhook event:', error.message, error.stack);
    res.status(500).send('Internal server error while processing webhook.');
  }
};

module.exports = {
    handlePolarWebhook
};