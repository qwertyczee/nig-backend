const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const LEMON_SQUEEZY_SIGNING_KEY = process.env.LEMON_SQUEEZY_SIGNING_KEY;

if (!LEMON_SQUEEZY_SIGNING_KEY) {
    console.warn("LEMON_SQUEEZY_SIGNING_KEY není nastaven v .env. Verifikace webhooku bude neúspěšná nebo přeskočena.");
}

const storeId = process.env.LEMON_SQUEEZY_STORE_ID;
const variantId = process.env.LEMON_SQUEEZY_VARIANT_ID;
const apiKey = process.env.LEMON_SQUEEZY_API_KEY;

const lemonSqueezyApi = axios.create({
    baseURL: 'https://api.lemonsqueezy.com/v1',
    headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    }
});

/**
 * Creates a Lemon Squeezy checkout URL.
 * @param {object} params - The parameters for creating the checkout.
 * @param {object} params.user - User details.
 * @param {object} params.address - Address details.
 * @param {string} params.discountCode - Discount code.
 * @param {number} params.totalPriceInCents - Total price in cents.
 * @returns {Promise<string>} The checkout URL.
 */
async function createLemonSqueezyCheckout({ user, address, discountCode, totalPriceInCents }) {
    try {
        if (!storeId) {
            throw new Error('LEMON_SQUEEZY_STORE_ID environment variable is not set.');
        }
        if (!variantId) {
            throw new Error('LEMON_SQUEEZY_VARIANT_ID environment variable is not set.');
        }
        if (!apiKey) {
            throw new Error('LEMON_SQUEEZY_API_KEY environment variable is not set.');
        }

        const country = address?.country ? String(address.country).toUpperCase() : '';

        const payload = {
            data: {
                type: "checkouts",
                attributes: {
                    custom_price: Number(totalPriceInCents),
                    product_options: {
                        name: 'Slavesonline',
                        description: 'Payment',
                        redirect_url: 'https://www.slavesonline.store/order/success',
                    },
                    checkout_options: {
                        embed: true,
                    },
                    checkout_data: {
                        email: user?.email || '',
                        name: user?.name || '',
                        billing_address: {
                            country: country,
                            zip: String(address?.postalCode || ''),
                            address: address?.street || '',
                            city: address?.city || '',
                        },
                        //discount_code: String(discountCode || ''),
                        custom: {
                            user_id: String(user?.id || 'guest'),
                            user_email: String(user?.email || '')
                        }
                    }
                },
                relationships: {
                    store: {
                        data: {
                            type: "stores",
                            id: String(storeId)
                        }
                    },
                    variant: {
                        data: {
                            type: "variants",
                            id: String(variantId)
                        }
                    }
                }
            }
        };

        const response = await lemonSqueezyApi.post('/checkouts', payload);

        if (!response.data?.data?.attributes?.url) {
            throw new Error('No checkout URL in response');
        }

        return response.data.data.attributes.url;
    } catch (error) {
        console.error('LemonSqueezy Checkout Creation Error:', JSON.stringify(error.response?.data, null, 2) || error.message);
        throw error;
    }
}

/**
 * Verifies the signature of a Lemon Squeezy webhook request.
 * @param {object} req - The Express request object.
 * @returns {boolean} True if the signature is valid, false otherwise.
 */
function verifyLemonSqueezyWebhook(req) {
    if (!LEMON_SQUEEZY_SIGNING_KEY) {
        console.error('Chyba verifikace webhooku: LEMON_SQUEEZY_SIGNING_KEY není nakonfigurován.');
        return false;
    }

    const signatureHeader = req.get('X-Signature');
    if (!signatureHeader) {
        console.warn('Chyba verifikace webhooku: Chybí hlavička X-Signature.');
        return false;
    }

    const rawBody = req.body;

    if (!Buffer.isBuffer(rawBody)) {
        console.error('Chyba verifikace webhooku: Raw tělo requestu není Buffer nebo není dostupné. Ujistěte se, že express.raw() middleware je správně nastaven pro tuto route.');
        return false;
    }

    try {
        const hmac = crypto.createHmac('sha256', LEMON_SQUEEZY_SIGNING_KEY);
        const digest = Buffer.from(hmac.update(rawBody).digest('hex'), 'utf8');
        const signature = Buffer.from(signatureHeader, 'utf8');

        if (digest.length !== signature.length) {
            console.warn('Chyba verifikace webhooku: Délky podpisů se neshodují.');
            return false;
        }

        if (crypto.timingSafeEqual(digest, signature)) {
            console.log('Webhook signature verified successfully.');
            return true;
        } else {
            console.warn('Chyba verifikace webhooku: Podpisy se neshodují.');
            console.log('Očekávaný digest (hex):', digest.toString('hex'));
            console.log('Přijatý X-Signature:', signatureHeader);
            return false;
        }
    } catch (error) {
        console.error('Chyba při verifikaci podpisu webhooku:', error);
        return false;
    }
}

module.exports = {
    createLemonSqueezyCheckout,
    verifyLemonSqueezyWebhook,
};