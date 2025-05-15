// services/polarService.js
const { Polar } = require('@polar-sh/sdk');
const dotenv = require('dotenv');
const path = require('path');
const crypto = require('crypto');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const polarSecretKey = process.env.POLAR_SECRET_KEY;
const polarWebhookSecret = process.env.POLAR_WEBHOOK_SECRET;

const polar = new Polar({
  server: 'sandbox',
  accessToken: polarSecretKey,
});

console.log('PolarService initialized with server:', 'sandbox');
if (!polarSecretKey) {
  console.warn('⚠️ POLAR_SECRET_KEY is not set. PolarService will not function.');
}
if (!polarWebhookSecret) {
  console.warn('⚠️ POLAR_WEBHOOK_SECRET is not set. Webhook verification disabled.');
}

async function createPolarProduct({ name, description, organizationId, priceAmount, currency = 'usd' }) {
  console.log('→ PolarService.createPolarProduct called with:', {
    name, description, organizationId, priceAmount, currency
  });
  try {
    const payload = {
      name,
      description,
      organization_id: organizationId,
      prices: [{ price_currency: currency, price_amount: priceAmount }],
    };
    console.log('  • Payload for polar.products.create():', payload);

    const response = await polar.products.create(payload);
    console.log('  • Raw Polar SDK response:', response);

    const created = response.value ?? response;
    console.log('  • Parsed created product:', created);

    if (!created.prices || created.prices.length === 0 || !created.prices[0].id) {
      throw new Error('Polar product created but missing price ID');
    }
    console.log('  ✔️ Polar product created with ID:', created.id, 'price ID:', created.prices[0].id);
    return created;
  } catch (err) {
    console.error('❌ Error in createPolarProduct:', err.message);
    throw err;
  }
}

/**
 * Vytvoří checkout session s dynamickou částkou pro pay-what-you-want.
 */
async function createCheckoutSession({ productId, amount, customerEmail, billingAddress, metadata }) {
  console.log('→ PolarService.createCheckoutSession called with:', {
    productId, amount, customerEmail, billingAddress, metadata
  });
  try {
    const payload = {
      products: [productId],
      amount, // v centech
      customerEmail,
      customerBillingAddress: billingAddress,
      metadata,
    };
    console.log('  • Payload for polar.checkouts.create():', payload);

    const session = await polar.checkouts.create(payload);
    const sess = session.value ?? session;
    console.log('  ✔️ Checkout session created:', sess.id, sess.url);
    return sess;
  } catch (err) {
    console.error('❌ Error in createCheckoutSession:', err.message);
    throw err;
  }
}

module.exports = {
  createPolarProduct,
  createCheckoutSession,
  verifyPolarWebhookSignature: (rawBody, signatureHeader) => {
    console.log('→ Verifying webhook signature...');
    if (!polarWebhookSecret || !signatureHeader) {
      console.warn('Webhook secret or signature header missing.');
      return false;
    }
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    const hmac = crypto.createHmac('sha256', polarWebhookSecret).update(rawBody).digest('hex');
    const isValid = crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(hmac, 'hex'));
    console.log('  • Computed HMAC:', hmac, 'Received:', signature, 'Valid:', isValid);
    return isValid;
  }
};
