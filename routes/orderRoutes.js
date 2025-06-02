const { Router } = require('express');
const {
	createOrder,
	getOrderById,
	cancelMyOrder,
} = require('../controllers/orderController');
const { protect } = require('../middleware/authMiddleware');

const router = Router();

/**
 * Route to create a new order.
 * @route POST /api/orders
 */
router.post('/', createOrder);

/**
 * Route to get an order by its ID, protected by authentication.
 * @route GET /api/orders/:id
 */
router.get('/:id', protect, getOrderById);

/**
 * Route to cancel an order by its ID, protected by authentication.
 * @route PATCH /api/orders/:id/cancel
 */
router.patch('/:id/cancel', protect, cancelMyOrder);

module.exports = router;