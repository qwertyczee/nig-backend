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
      const orderData = event.data;
      const internalUserId = event.meta.custom_data?.user_id;
      const customerEmail = orderData?.attributes?.user_email;
      // Update order status in DB
      if (internalUserId) {
        await supabase
          .from('orders')
          .update({ status: 'processing', payment_intent_id: orderData.id })
          .eq('user_id', internalUserId)
          .eq('status', 'awaiting_payment');
      }
      // Send email with product images
      if (customerEmail) {
        // Find the order by user_id and status=processing, get its items and product images
        const { data: order, error: orderError } = await supabase
          .from('orders')
          .select(`id, order_items (quantity, products (name, image_url))`)
          .eq('user_id', internalUserId)
          .eq('status', 'processing')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        if (orderError || !order) {
          console.error('Could not fetch order for email:', orderError?.message);
        } else {
          // Build HTML with product images
          let html = `<h2>Děkujeme za vaši objednávku!</h2><p>Zde jsou vaše zakoupené obrázky:</p><div style="display:flex;flex-wrap:wrap;gap:16px;">`;
          for (const item of order.order_items) {
            const product = item.products;
            if (product && product.image_url) {
              html += `<div style="text-align:center;"><img src="${product.image_url}" alt="${product.name}" style="max-width:300px;max-height:300px;display:block;margin-bottom:8px;"/><div>${product.name}</div></div>`;
            }
          }
          html += '</div>';
          try {
            await resend.emails.send({
              from: 'Slavesonline <noreply@slavesonline.store>',
              to: customerEmail,
              subject: 'Děkujeme za vaši objednávku',
              html
            });
            console.log(`[EMAIL] Sent to ${customerEmail}`);
          } catch (mailErr) {
            console.error('Error sending email via Resend:', mailErr);
          }
        }
      } else {
        console.log(`[EMAIL] Payment successful for user: ${internalUserId}, but email not found in webhook payload`);
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