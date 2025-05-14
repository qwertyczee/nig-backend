import express from 'express';
import { handlePolarWebhook } from '../controllers/webhookController';

const router = express.Router();

router.post('/polar', handlePolarWebhook);

export default router;