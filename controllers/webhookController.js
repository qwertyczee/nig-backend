const { verifyLemonSqueezyWebhook } = require('../services/lemonsqueezyService');
const webhookTasks = require('../services/webhookTasks');

/**
 * Handles incoming Lemon Squeezy webhook events.
 * Verifies the webhook signature and processes 'order_created' events.
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 */
const handleLemonSqueezyWebhook = async (req, res) => {
  if (!verifyLemonSqueezyWebhook(req)) {
    console.warn('Webhook signature verification failed.');
    return res.status(403).send('Webhook signature verification failed.');
  }

  let event;
  try {
    event = JSON.parse(req.body.toString());
  } catch (e) {
    console.error('Invalid JSON payload:', e);
    return res.status(400).send('Webhook error: Invalid JSON payload.');
  }

  console.log(JSON.stringify(event, null, 2))

  try {
    if (event.meta && event.meta.event_name === 'order_created') {
      console.log(`Processing 'order_created' event. Event ID: ${event.meta.webhook_id}`);
      const orderData = event.data;
      const orderId = event.meta.custom_data?.user_id;
      const customerEmail = orderData?.attributes?.user_email;

      if (!orderId) {
        console.error(`'user_id' (our order ID) not found in custom_data for event ${event.meta.webhook_id}.`);
        return res.status(400).send('Webhook error: Missing user_id in custom_data. Cannot link to internal order.');
      }
      
      console.log(`Internal Order ID: ${orderId}, Customer Email: ${customerEmail}`);

      const updatedOrder = await webhookTasks.updateOrderStatusToPaid(orderId, customerEmail);
      console.log(`Status updated to 'paid' for order ${orderId}.`);

      if (!updatedOrder) {
        console.warn(`Order ${orderId} was not updated or found after payment status update. Skipping subsequent tasks.`);
        return res.status(200).send('Webhook received, order status not updated (likely already processed or wrong initial state).');
      }

      if (updatedOrder.user_id) {
        await webhookTasks.sendOrderReceivedEmail(updatedOrder);
        console.log(`'Order Received' email task completed for order ${updatedOrder.id}.`);
      } else {
        console.warn(`Customer email not found in updated order data for order ${updatedOrder.id}. Skipping 'Order Received' email.`);
      }

      if (updatedOrder.user_id) {
        console.log(`Initiating background processing for 'shipped/ready' email and status update for order ${updatedOrder.id}.`);
        await webhookTasks.processOrderItemsAndSendShippedEmail(updatedOrder)
          .then(() => {
            console.log(`'processOrderItemsAndSendShippedEmail' completed for order ${updatedOrder.id}.`);
            return webhookTasks.updateOrderStatusToShipped(updatedOrder.id);
          })
          .then(() => {
            console.log(`Status updated to 'shipped' for order ${updatedOrder.id} after email processing.`);
          })
          .catch(err => {
            console.error(`Error in async processing (shipped email or status update) for order ${updatedOrder.id}:`, err);
          });
      } else {
        console.warn(`Customer email not found in updated order data for order ${updatedOrder.id}. Skipping 'shipped/ready' email and subsequent status update to 'shipped'.`);
      }

      res.status(200).send('Webhook received and processing initiated.');

    } else {
      console.log(`Event ${event.meta ? event.meta.event_name : 'UNKNOWN_EVENT'} (ID: ${event.meta?.event_id}) received, but not 'order_created'. Skipping.`);
      res.status(200).send('Webhook event received, but not processed (not order_created).');
    }
  } catch (error) {
    console.error('Internal server error while processing webhook:', error.message, error.stack);
    res.status(500).send('Internal server error while processing webhook.');
  }
};

module.exports = {
  handleLemonSqueezyWebhook
};