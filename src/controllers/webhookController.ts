import { Request, Response } from 'express';
import { supabase } from '../config/db';
import { verifyPolarWebhookSignature } from '../services/polarService'; // Import the verification function
import { OrderStatus } from '../types/orderTypes';

// Note: The Polar SDK instance might not be needed here if webhooks are just events
// and don't require further SDK calls for verification (depends on Polar's design).
// const polar = new Polar(); // Removed as verifyPolarWebhookSignature is standalone

export const handlePolarWebhook = async (req: Request, res: Response) => {
  const signatureHeader = req.headers['polar-signature'] as string; // Adjust if Polar uses a different header
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
  } catch (e: any) {
    console.error('Error parsing webhook JSON payload:', e.message);
    return res.status(400).send('Webhook error: Invalid JSON payload.');
  }
  
  console.log('Polar webhook event received and signature verified:', event.type, event.id);

  try {
    // Process the event based on its type
    // IMPORTANT: Replace 'checkout.session.completed' and paths to data with actual Polar event types and structures.
    if (event.type === 'checkout.session.completed') {
      const checkoutSession = event.data?.object; // Adjust path based on actual Polar event structure
      const orderId = checkoutSession?.metadata?.internal_order_id;
      const polarChargeId = checkoutSession?.payment_intent_id || checkoutSession?.id; // Or other relevant ID from Polar

      if (orderId && checkoutSession?.status === 'paid') { // Check if payment was successful
        console.log(`Processing successful payment for order: ${orderId}, Polar Charge ID: ${polarChargeId}`);
        const { error } = await supabase
          .from('orders')
          .update({
            status: 'processing' as OrderStatus, // Or 'completed', 'paid', etc.
            payment_intent_id: polarChargeId, // Update with actual charge/payment ID from Polar
            // You might add a specific 'polar_charge_id' column if 'payment_intent_id' is used for session ID before payment.
          })
          .eq('id', orderId)
          .eq('status', 'awaiting_payment'); // Ensure we only update orders awaiting payment

        if (error) {
          console.error(`Error updating order ${orderId} to paid:`, error.message);
          // Potentially retry or log for manual intervention
          return res.status(500).send('Error updating order status in database.');
        }
        console.log(`Order ${orderId} status updated to processing/paid.`);
        // TODO: Implement any post-payment success logic (e.g., send confirmation email, trigger fulfillment)
      } else if (orderId && checkoutSession?.status === 'failed') { // Example for failed payment
         console.log(`Processing failed payment for order: ${orderId}`);
         const { error } = await supabase
          .from('orders')
          .update({ status: 'payment_failed' as OrderStatus })
          .eq('id', orderId)
          .eq('status', 'awaiting_payment');
        if (error) {
          console.error(`Error updating order ${orderId} to payment_failed:`, error.message);
        } else {
          console.log(`Order ${orderId} status updated to payment_failed.`);
        }
      } else {
        console.warn('Webhook event checkout.session.completed received, but orderId missing or payment not successful. Metadata:', checkoutSession?.metadata);
      }
    } else if (event.type === 'checkout.session.expired') {
        const checkoutSession = event.data?.object;
        const orderId = checkoutSession?.metadata?.internal_order_id;
        if (orderId) {
            console.log(`Checkout session expired for order: ${orderId}`);
            // Optionally update order status to 'cancelled' or 'payment_failed'
            const { error } = await supabase
                .from('orders')
                .update({ status: 'cancelled' as OrderStatus }) // Or 'payment_failed'
                .eq('id', orderId)
                .eq('status', 'awaiting_payment');
            if (error) {
                console.error(`Error updating order ${orderId} to cancelled due to expired session:`, error.message);
            } else {
                console.log(`Order ${orderId} marked as cancelled due to expired Polar session.`);
            }
        }
    }
    // Add more event types as needed (e.g., 'charge.refunded')

    res.status(200).send('Webhook processed.');
  } catch (error: any) {
    console.error('Error processing Polar webhook event:', error.message, error.stack);
    res.status(500).send('Internal server error while processing webhook.');
  }
};