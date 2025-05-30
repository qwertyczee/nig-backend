const { verifyLemonSqueezyWebhook } = require('../services/lemonsqueezyService');
const webhookTasks = require('../services/webhookTasks');

const handleLemonSqueezyWebhook = async (req, res) => {
  if (!verifyLemonSqueezyWebhook(req)) {
    console.warn('[WEBHOOK_AUTH_FAIL] Webhook signature verification failed.');
    return res.status(403).send('Webhook signature verification failed.');
  }

  let event;
  try {
    event = req.body;
  } catch (e) {
    console.error('[WEBHOOK_PARSE_ERROR] Invalid JSON payload:', e);
    return res.status(400).send('Webhook error: Invalid JSON payload.');
  }

  try {
    if (event.meta && event.meta.event_name === 'order_created') {
      console.log(`[WEBHOOK_INFO] Processing 'order_created' event. Event ID: ${event.meta.event_id}`);
      const orderData = event.data;
      const orderId = event.meta.custom_data?.user_id; // Naše interní ID objednávky
      const lemonSqueezyOrderId = orderData?.attributes?.identifier; // ID objednávky u Lemon Squeezy (např. ODR_xxxx)
      const customerEmail = orderData?.attributes?.user_email;
      // const paymentIntentId = orderData?.id; // ID objektu 'Order' v Lemon Squeezy databázi

      if (!orderId) {
        console.error(`[WEBHOOK_ERROR] 'user_id' (our order ID) not found in custom_data for event ${event.meta.event_id}. Lemon Squeezy Order ID: ${lemonSqueezyOrderId}`);
        return res.status(400).send('Webhook error: Missing user_id in custom_data. Cannot link to internal order.');
      }
      
      console.log(`[WEBHOOK_DATA] Internal Order ID: ${orderId}, Customer Email: ${customerEmail}, Lemon Squeezy Order ID: ${lemonSqueezyOrderId}`);

      // --- Sekvence tasků ---
      // 1. Aktualizace stavu objednávky na 'paid' a uložení LS Order ID
      await webhookTasks.updateOrderStatusToPaid(orderId, lemonSqueezyOrderId, customerEmail);
      console.log(`[WEBHOOK_PROGRESS] Status updated to 'paid' for order ${orderId}.`);

      // 2. Odeslání emailu "Objednávka přijata"
      if (customerEmail) {
        // Tento email je rychlý, můžeme na něj počkat
        await webhookTasks.sendOrderReceivedEmail(orderId, customerEmail);
        console.log(`[WEBHOOK_PROGRESS] 'Order Received' email task completed for order ${orderId}.`);
      } else {
        console.warn(`[WEBHOOK_WARN] Customer email not found for order ${orderId}. Skipping 'Order Received' email.`);
      }

      // 3. Zpracování položek, ZIP, email s produkty/odkazem a následný update stavu
      // Tyto operace mohou být delší, spouštíme je asynchronně, aby webhook rychle odpověděl.
      if (customerEmail) {
        console.log(`[WEBHOOK_PROGRESS] Initiating background processing for 'shipped/ready' email and status update for order ${orderId}.`);
        webhookTasks.processOrderItemsAndSendShippedEmail(orderId, customerEmail)
          .then(() => {
            console.log(`[WEBHOOK_SUBTASK_COMPLETE] 'processOrderItemsAndSendShippedEmail' completed for order ${orderId}.`);
            // 4. Aktualizace stavu objednávky na 'shipped' (nebo 'completed')
            return webhookTasks.updateOrderStatusToShipped(orderId);
          })
          .then(() => {
            console.log(`[WEBHOOK_SUBTASK_COMPLETE] Status updated to 'shipped' for order ${orderId} after email processing.`);
          })
          .catch(err => {
            // Toto je chyba v asynchronním zpracování na pozadí.
            // Měla by být zalogována a případně by měl být systém pro retry nebo manuální kontrolu.
            console.error(`[WEBHOOK_BACKGROUND_ERROR] Error in async processing (shipped email or status update) for order ${orderId}:`, err);
          });
      } else {
        console.warn(`[WEBHOOK_WARN] Customer email not found for order ${orderId}. Skipping 'shipped/ready' email and subsequent status update to 'shipped'.`);
        // Zvážit, zda v tomto případě status měnit na 'shipped' i bez emailu, nebo zavést jiný stav.
      }

      // Webhook by měl odpovědět rychle 200 OK.
      res.status(200).send('Webhook received and processing initiated.');

    } else {
      console.log(`[WEBHOOK_INFO] Event ${event.meta ? event.meta.event_name : 'UNKNOWN_EVENT'} (ID: ${event.meta?.event_id}) received, but not 'order_created'. Skipping.`);
      res.status(200).send('Webhook event received, but not processed (not order_created).');
    }
  } catch (error) {
    // Toto je chyba v synchronní části zpracování webhooku (např. první update stavu nebo chyba v logice zde).
    console.error('[WEBHOOK_ERROR] Internal server error while processing webhook:', error.message, error.stack);
    res.status(500).send('Internal server error while processing webhook.');
  }
};

module.exports = {
  handleLemonSqueezyWebhook
};