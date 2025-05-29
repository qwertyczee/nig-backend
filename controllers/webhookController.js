const { supabase } = require('../config/db');
const { verifyLemonSqueezyWebhook } = require('../services/lemonsqueezyService');
const Resend = require('resend').Resend;
const resend = new Resend(process.env.RESEND_API_KEY);

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

  try {
    // Only process successful payment (order_created)
    if (event.meta && event.meta.event_name === 'order_created') {
      console.log("Event Data: ", JSON.stringify(event, null, 2));
      const orderData = event.data;
      const orderId = event.meta.custom_data?.user_id;
      const customerEmail = orderData?.attributes?.user_email;
      // Update order status in DB
      if (orderId) {
        await supabase
          .from('orders')
          .update({ status: 'processing', payment_intent_id: orderData.id })
          .eq('id', orderId)
          .eq('status', 'awaiting_payment');
      }
      // Send email with product images
      if (customerEmail) {
        // Najdi objednávku podle order_id
        const { data: order, error: orderError } = await supabase
          .from('orders')
          .select(`id, order_items (quantity, products (name, image_url))`)
          .eq('id', orderId)
          .eq('status', 'processing')
          .single();
        if (orderError || !order) {
          console.error('Could not fetch order for email:', orderError?.message);
        } else {
          // Build HTML with product images
          let html = `<h2>Děkujeme za vaši objednávku!</h2><p>Zde jsou vaše zakoupené produkty:</p><div style="display:flex;flex-wrap:wrap;gap:16px;">`;
          for (const item of order.order_items) {
            const product = item.products;
            if (product) {
              html += `<div style="text-align:center;">`;
              if (product.image_url) {
                html += `<img src="${product.image_url}" alt="${product.name}" style="max-width:300px;max-height:300px;display:block;margin-bottom:8px;"/>`;
              }
              html += `<div>${product.name}</div></div>`;
            }
          }
          html += '</div>';
          try {
            await resend.emails.send({
              from: 'Slavesonline <noreply@learbuddy.fun>',
              to: customerEmail,
              subject: 'Děkujeme za vaši objednávku',
              html
            });
            console.log(`[EMAIL] Sent to ${customerEmail}`);

            await supabase
              .from('orders')
              .update({ status: 'shipped' })
              .eq('id', orderId)
              .eq('status', 'awaiting_payment');
          } catch (mailErr) {
            console.error('Error sending email via Resend:', mailErr);
          }
        }
      } else {
        console.log(`[EMAIL] Payment successful for order: ${orderId}, but email not found in webhook payload`);
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