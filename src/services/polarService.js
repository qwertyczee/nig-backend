<<<<<<< HEAD
const { Polar } = require('@polar-sh/sdk');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const polarSecretKey = process.env.POLAR_SECRET_KEY;
const polarWebhookSecret = process.env.POLAR_WEBHOOK_SECRET;

if (!polarSecretKey) {
  console.warn('POLAR_SECRET_KEY is not set. PolarService will not function.');
}
if (!polarWebhookSecret) {
  console.warn('POLAR_WEBHOOK_SECRET is not set. Polar webhook verification will not function.');
}

const polar = new Polar({
  //server: 'sandbox',
  accessToken: polarSecretKey, // Use secret key for server-side operations
});

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://nig-frontend.vercel.app'; // Fallback, ensure this is set in Vercel

/**
 * Creates a checkout session with Polar.sh using the SDK.
 */
const createPolarCheckoutSession = async (
  orderId, // Your internal order ID
  items,
  customerEmail,
  billingAddress,
  // totalAmountInCents: number, // No longer directly passed if Polar calculates from items
  // currency: string = 'usd' // Currency is usually part of the price_id in Polar
) => {
  if (!polarSecretKey) {
    // Fallback to simulation if secret key is not set (e.g. local dev without .env)
    console.warn('PolarService: POLAR_SECRET_KEY not set. Simulating checkout session creation.');
    const simulatedSessionId = `cs_sim_${Date.now()}`;
    // const simulatedAmount = items.reduce((sum, item) => sum + item.price_in_cents * item.quantity, 0); // If items had price
    return {
      checkoutUrl: `${FRONTEND_URL}/simulated-polar-checkout?session_id=${simulatedSessionId}&order_id=${orderId}`,
      polarSessionId: simulatedSessionId,
    };
  }

  try {
    console.log(`PolarService: Attempting to create real checkout session for order ${orderId}`);

    const successUrl = `${FRONTEND_URL}/order/success`; // Polar might append session_id, or success page handles it
    const cancelUrl = `${FRONTEND_URL}/cart`; // Or a dedicated cancellation page

    // Prepare products array for Polar: array of price_id strings, repeated by quantity
    const productsForPolar = [];
    items.forEach(item => {
      for (let i = 0; i < item.quantity; i++) {
        // Assuming item.priceId (originating from your DB product.id) IS the Polar Price ID
        productsForPolar.push(item.priceId);
      }
    });

    if (productsForPolar.length === 0) {
      throw new Error('No items to checkout.');
    }
    
    // Reverted to string[] for products as per SDK type definition.
    // If Polar still errors about missing product_id/product_price_id,
    // it means the strings in `productsForPolar` are not recognized as valid Polar Price IDs,
    // or there's a deeper configuration issue with the products/prices in your Polar account.

    const polarSession = await polar.checkouts.create({
      products: productsForPolar, // Should be string[]
      // successUrl: successUrl, // Removed as it's not a direct property of CheckoutCreate
      // cancelUrl: cancelUrl,   // Removed as it's not a direct property of CheckoutCreate
      // Ensure success and cancel URLs are configured in your Polar dashboard or if the SDK
      // expects them under a different property or structure.
      customerEmail: customerEmail,
      customerBillingAddress: { // Assuming Polar SDK takes an object like this
        country: billingAddress.country,
        postalCode: billingAddress.postal_code, // Pass if available and supported
        // Add other address fields here if needed by Polar SDK:
        // line1: billingAddress.line1,
        // city: billingAddress.city,
        // state: billingAddress.state,
      },
      metadata: {
        internal_order_id: orderId,
      },
      // organizationId: process.env.POLAR_ORGANIZATION_ID, // If creating checkouts for a specific org
      // paymentMethodTypes: ['card'], // If you need to specify
      // Polar SDK might require success_url and cancel_url within a different object or they are set globally.
      // For now, assuming they are handled by Polar's dashboard settings or implicitly.
      // If redirects don't work, you'll need to consult Polar's SDK docs for how to pass these.
      // The `CheckoutCreate` type from the docs snippet did not show these as top-level properties.
      // It's possible they are part of an `options` object or similar.
    });

    console.log('PolarService: Real checkout session created:', polarSession.id, 'URL:', polarSession.url);

    if (!polarSession.url || !polarSession.id) {
      throw new Error('Polar did not return a valid checkout URL or session ID.');
    }

    return {
      checkoutUrl: polarSession.url,
      polarSessionId: polarSession.id,
    };
  } catch (error) {
    console.error('PolarService: Error creating checkout session with Polar SDK:', error.message, error.stack);
    // Log more details if available from Polar's error object
    if (error.response?.data) {
      console.error('Polar SDK error response:', error.response.data);
    }
    throw new Error(`Failed to create checkout session with Polar: ${error.message}`);
  }
};

const crypto = require('crypto');

/**
 * Verifies a webhook signature from Polar.sh.
 * This is a generic HMAC-SHA256 implementation. You MUST verify Polar's specific requirements:
 * - The exact header name for the signature (e.g., 'Polar-Signature', 'X-Polar-Signature').
 * - The exact algorithm (e.g., 'sha256', 'sha512').
 * - How the signature is constructed (e.g., if it includes timestamps or other elements).
 * - The encoding of the signature (e.g., hex, base64).
 */
const verifyPolarWebhookSignature = (
  rawBody, // IMPORTANT: This MUST be the raw, unparsed request body.
  signatureHeader, // The signature string from the request header.
  webhookSecret // Your POLAR_WEBHOOK_SECRET from environment variables.
) => {
  if (!webhookSecret) {
    console.error('PolarService: POLAR_WEBHOOK_SECRET is not set. Cannot verify webhook signature.');
    // In a production environment, you might want to return false or throw an error.
    // For local dev, if you explicitly want to bypass, handle with extreme caution.
    // Returning true here for a missing secret is INSECURE.
    // For now, let's be strict: if no secret, verification fails.
    return false;
  }

  if (!signatureHeader) {
    console.error('PolarService: Missing webhook signature header. Webhook event will be rejected.');
    return false;
  }

  // Ensure signatureHeader is a string if it's an array (though typically it's a single string)
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

  try {
    // This is a common way to verify HMAC signatures. Polar might have variations.
    // Example: Stripe uses 't=' for timestamp and 'v1=' for signature parts in their header.
    // Adapt this logic if Polar's signature format is different (e.g., includes versioning or timestamps).

    const hmac = crypto.createHmac('sha256', webhookSecret); // Assuming SHA256, Polar might use a different algo.
    const computedSignature = hmac.update(rawBody).digest('hex'); // Assuming hex encoding.

    // Securely compare the computed signature with the received signature.
    // crypto.timingSafeEqual is preferred for security against timing attacks.
    // Both buffers must be of the same length for timingSafeEqual.
    const receivedSignatureBuffer = Buffer.from(signature, 'hex'); // Assuming hex encoding for received sig
    const computedSignatureBuffer = Buffer.from(computedSignature, 'hex');
    
    if (receivedSignatureBuffer.length !== computedSignatureBuffer.length) {
        console.warn('PolarService: Webhook signature length mismatch.');
        return false;
    }

    const isValid = crypto.timingSafeEqual(receivedSignatureBuffer, computedSignatureBuffer);
    
    if (!isValid) {
        console.warn('PolarService: Webhook signature verification failed. Signatures do not match.');
    } else {
        console.log('PolarService: Webhook signature verified successfully.');
    }
    return isValid;

  } catch (error) {
    console.error('PolarService: Error during webhook signature verification:', error.message);
    return false;
  }
};

module.exports = {
    polar,
    createPolarCheckoutSession,
    verifyPolarWebhookSignature
};
=======
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
>>>>>>> d8c64ce4af9d6fb7bd9bcdf0bf332403ccbd06ca
