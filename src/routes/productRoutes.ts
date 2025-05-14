import { Router } from 'express';
import {
	getAllProducts,
	getProductById,
	createProduct,
	updateProduct,
	deleteProduct
} from '../controllers/productController';
import { protect, admin } from '../middleware/authMiddleware'; // Example of how you might import

const router = Router();

router.get('/', getAllProducts);
router.post('/', protect, createProduct); // Create a new product

router.get('/:id', getProductById);
router.put('/:id', protect, updateProduct); // Update a product by ID
router.delete('/:id', protect, deleteProduct); // Delete a product by ID

export default router;
