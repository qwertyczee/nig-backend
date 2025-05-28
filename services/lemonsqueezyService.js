const axios = require('axios');
require('dotenv').config();

const storeId = process.env.LEMON_SQUEEZY_STORE_ID;
const variantId = process.env.LEMON_SQUEEZY_VARIANT_ID;
const apiKey = process.env.LEMON_SQUEEZY_API_KEY;

// Create axios instance with base configuration
const lemonSqueezyApi = axios.create({
    baseURL: 'https://api.lemonsqueezy.com/v1',
    headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    }
});

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

        // Ensure country is a valid 2-letter ISO code
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
                            user_id: String(user?.id || 'guest')
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

function verifyLemonSqueezyWebhook(req) {
    // TODO: Implement webhook signature verification if needed
    return true;
}

module.exports = {
    createLemonSqueezyCheckout,
    verifyLemonSqueezyWebhook,
}; 