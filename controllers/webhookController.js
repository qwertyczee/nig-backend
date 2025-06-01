const { verifyLemonSqueezyWebhook } = require('../services/lemonsqueezyService');
const webhookTasks = require('../services/webhookTasks');

const handleLemonSqueezyWebhook = async (req, res) => {
  if (!verifyLemonSqueezyWebhook(req)) {
    console.warn('[WEBHOOK_AUTH_FAIL] Webhook signature verification failed.');
    return res.status(403).send('Webhook signature verification failed.');
  }

  let event;
  try {
    event = JSON.parse(req.body.toString());
  } catch (e) {
    console.error('[WEBHOOK_PARSE_ERROR] Invalid JSON payload:', e);
    return res.status(400).send('Webhook error: Invalid JSON payload.');
  }

  console.log(JSON.stringify(event, null, 2))

  try {
    if (event.meta && event.meta.event_name === 'order_created') {
      console.log(`[WEBHOOK_INFO] Processing 'order_created' event. Event ID: ${event.meta.webhook_id}`);
      const orderData = event.data;
      const orderId = event.meta.custom_data?.user_id;
      const customerEmail = orderData?.attributes?.user_email;

      if (!orderId) {
        console.error(`[WEBHOOK_ERROR] 'user_id' (our order ID) not found in custom_data for event ${event.meta.webhook_id}.`);
        return res.status(400).send('Webhook error: Missing user_id in custom_data. Cannot link to internal order.');
      }
      
      console.log(`[WEBHOOK_DATA] Internal Order ID: ${orderId}, Customer Email: ${customerEmail}`);

      // --- Sekvence tasků ---
      // 1. Aktualizace stavu objednávky na 'paid' a uložení LS Order ID
      const updatedOrder = await webhookTasks.updateOrderStatusToPaid(orderId, customerEmail);
      console.log(`[WEBHOOK_PROGRESS] Status updated to 'paid' for order ${orderId}.`);

      if (!updatedOrder) {
        console.warn(`[WEBHOOK_WARN] Order ${orderId} was not updated or found after payment status update. Skipping subsequent tasks.`);
        // Respond 200 OK because the webhook was handled, but the order wasn't in the right state.
        // A system for monitoring these warnings is recommended.
        return res.status(200).send('Webhook received, order status not updated (likely already processed or wrong initial state).');
      }

      // 2. Odeslání emailu "Objednávka přijata" - using the updated order data
      if (updatedOrder.user_id) { // Check if email is available in the updated order data
        // This email is quick, we can await it
        await webhookTasks.sendOrderReceivedEmail(updatedOrder); // Pass the full order object
        console.log(`[WEBHOOK_PROGRESS] 'Order Received' email task completed for order ${updatedOrder.id}.`);
      } else {
        console.warn(`[WEBHOOK_WARN] Customer email not found in updated order data for order ${updatedOrder.id}. Skipping 'Order Received' email.`);
      }

      // 3. Zpracování položek, ZIP, email s produkty/odkazem a následný update stavu
      // These operations can be longer, we run them asynchronously so the webhook responds quickly.
      if (updatedOrder.user_id) { // Check if email is available for the shipped email task
        console.log(`[WEBHOOK_PROGRESS] Initiating background processing for 'shipped/ready' email and status update for order ${updatedOrder.id}.`);
        // Pass the full order object
        webhookTasks.processOrderItemsAndSendShippedEmail(updatedOrder) // Do NOT await here
          .then(() => {
            console.log(`[WEBHOOK_SUBTASK_COMPLETE] 'processOrderItemsAndSendShippedEmail' completed for order ${updatedOrder.id}.`);
            // 4. Aktualizace stavu objednávky na 'shipped' (or 'completed')
            // Still use orderId for the status update as it's a direct DB operation
            return webhookTasks.updateOrderStatusToShipped(updatedOrder.id);
          })
          .then(() => {
            console.log(`[WEBHOOK_SUBTASK_COMPLETE] Status updated to 'shipped' for order ${updatedOrder.id} after email processing.`);
          })
          .catch(err => {
            // This is an error in the asynchronous background processing.
            // It should be logged and potentially require a retry system or manual check.
            console.error(`[WEBHOOK_BACKGROUND_ERROR] Error in async processing (shipped email or status update) for order ${updatedOrder.id}:`, err);
          });
      } else {
        console.warn(`[WEBHOOK_WARN] Customer email not found in updated order data for order ${updatedOrder.id}. Skipping 'shipped/ready' email and subsequent status update to 'shipped'.`);
        // Consider whether to change status to 'shipped' in this case even without email, or introduce a different status.
      }

      // Webhook should respond quickly 200 OK.
      // The response indicates successful receipt and initiation of processing, not completion of all tasks.
      res.status(200).send('Webhook received and processing initiated.');

    } else {
      console.log(`[WEBHOOK_INFO] Event ${event.meta ? event.meta.event_name : 'UNKNOWN_EVENT'} (ID: ${event.meta?.event_id}) received, but not 'order_created'. Skipping.`);
      res.status(200).send('Webhook event received, but not processed (not order_created).');
    }
  } catch (error) {
    // This catches errors in the synchronous part of the webhook processing (e.g., initial status update or logic errors here).
    console.error('[WEBHOOK_ERROR] Internal server error while processing webhook:', error.message, error.stack);
    res.status(500).send('Internal server error while processing webhook.');
  }
};

module.exports = {
  handleLemonSqueezyWebhook
};