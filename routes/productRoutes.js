const { Router } = require('express');
const {
	getAllProducts,
	getProductById
} = require('../controllers/productController');

const router = Router();

/**
 * Route to get all products.
 * @route GET /api/products
 */
router.get('/', getAllProducts);

/**
 * Route to get a product by its ID.
 * @route GET /api/products/:id
 */
router.get('/:id', getProductById);

module.exports = router;