const { Router } = require('express');
const {
	createOrder,
	getOrderById,
	cancelMyOrder,
} = require('../controllers/orderController');
const { protect } = require('../middleware/authMiddleware');

const router = Router();

router.post('/', createOrder);
router.get('/:id', protect, getOrderById);
router.patch('/:id/cancel', protect, cancelMyOrder);

module.exports = router;