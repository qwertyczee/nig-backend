const { Router } = require('express');
const {
	getAllProducts,
	getProductById
} = require('../controllers/productController');

const router = Router();

router.get('/', getAllProducts);
router.get('/:id', getProductById);

module.exports = router;