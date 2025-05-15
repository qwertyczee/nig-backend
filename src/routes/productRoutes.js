const { Router, Request, Response, NextFunction } = require('express');
const {
	getAllProducts,
	getProductById
} = require('../controllers/productController');
const { protect, admin } = require('../middleware/authMiddleware');

const router = Router();

router.get('/', getAllProducts);
router.get('/:id', getProductById);

module.exports = router;