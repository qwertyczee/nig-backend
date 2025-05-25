const express = require('express');
const { handleLemonSqueezyWebhook } = require('../controllers/webhookController');

const router = express.Router();

router.post('/lemonsqueezy', handleLemonSqueezyWebhook);

module.exports = router;