const express = require('express');
const { handleLemonSqueezyWebhook } = require('../controllers/webhookController');

const router = express.Router();

/**
 * Handles incoming Lemon Squeezy webhooks.
 * @route POST /api/webhooks/lemonsqueezy
 */
router.post('/lemonsqueezy', handleLemonSqueezyWebhook);

module.exports = router;