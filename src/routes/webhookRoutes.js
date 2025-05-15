const express = require('express');
const { handlePolarWebhook } = require('../controllers/webhookController');

const router = express.Router();

router.post('/polar', handlePolarWebhook);

module.exports = router;