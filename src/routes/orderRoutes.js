import { Router } from 'express';
import {
	createOrder,
	getMyOrders,
	getOrderById,
	cancelMyOrder
} from '../controllers/orderController';
import { protect, admin } from '../middleware/authMiddleware'; // Example of how you might import

const router = Router();

// User routes - RLS handles user-specific data access based on JWT from client
// The 'protect' middleware (if used here) would ensure a valid JWT is present
// and could attach user info to req.user for server-side logic if needed beyond RLS.

router.post('/', createOrder); // Removed 'protect' middleware for guest checkout
router.get('/', protect, getMyOrders); // Keep protect for viewing user's own orders
router.get('/:id', protect, getOrderById); // Keep protect for viewing specific order (RLS handles ownership)
router.patch('/:id/cancel', protect, cancelMyOrder); // Keep protect for cancelling (RLS handles ownership)

// Example Admin routes (you would uncomment and use 'admin' middleware)
// router.get('/admin/all', protect, admin, getAllOrdersForAdmin);
// router.put('/:id/admin/status', protect, admin, updateOrderStatusByAdmin);

export default router;