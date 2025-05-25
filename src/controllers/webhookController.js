const { supabase } = require('../config/db');
const { verifyLemonSqueezyWebhook } = require('../services/lemonsqueezyService');

// Note: The Polar SDK instance might not be needed here if webhooks are just events
// and don't require further SDK calls for verification (depends on Polar's design).
// const polar = new Polar(); // Removed as verifyPolarWebhookSignature is standalone

const handleLemonSqueezyWebhook = async (req, res) => {
  if (!verifyLemonSqueezyWebhook(req)) {
    return res.status(403).send('Webhook signature verification failed.');
  }
  let event;
  try {
    event = req.body;
  } catch (e) {
    return res.status(400).send('Webhook error: Invalid JSON payload.');
  }

  console.log("event_type: ", event)

  try {
    // Only process successful payment
    if (event.event_name === 'order_paid') {
      const orderData = event.data;
      const internalOrderId = orderData?.attributes?.custom_data?.user_id;
      const customerEmail = orderData?.attributes?.user_email || orderData?.attributes?.email;
      // Update order status in DB
      if (internalOrderId) {
        await supabase
          .from('orders')
          .update({ status: 'processing', payment_intent_id: orderData.id })
          .eq('user_id', internalOrderId)
          .eq('status', 'awaiting_payment');
      }
      // Simulate sending email
      if (customerEmail) {
        console.log(`[EMAIL] Payment successful for user: ${internalOrderId}, email: ${customerEmail}`);
      } else {
        console.log(`[EMAIL] Payment successful for user: ${internalOrderId}, but email not found in webhook payload`);
      }
    }
    res.status(200).send('Webhook processed.');
  } catch (error) {
    res.status(500).send('Internal server error while processing webhook.');
  }
};

module.exports = {
  handleLemonSqueezyWebhook: handleLemonSqueezyWebhook
};