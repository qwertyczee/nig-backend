import { Router, Request, Response, NextFunction } from 'express';
import {
	getAllProducts,
	getProductById,
	createProduct,
	updateProduct,
	deleteProduct
} from '../controllers/productController';
import { protect, admin } from '../middleware/authMiddleware';

const router = Router();
console.log('LOG: productRoutes.ts: Router file loaded and initialized.');

// Middleware specific to productRoutes to log path being hit within this router
router.use((req: Request, res: Response, next: NextFunction) => {
    console.log(`LOG: productRoutes.ts: Request within productRouter for path: ${req.method} ${req.baseUrl}${req.path}`);
    next();
});

router.get('/', (req: Request, res: Response, next: NextFunction) => {
    console.log('LOG: productRoutes.ts: Matched GET / (e.g., /api/products/). Forwarding to getAllProducts controller.');
    next();
}, getAllProducts);
console.log('LOG: productRoutes.ts: GET / route defined.');

router.post('/', protect, (req: Request, res: Response, next: NextFunction) => {
    console.log('LOG: productRoutes.ts: Matched POST / (e.g., /api/products/). Forwarding to createProduct controller.');
    next();
}, createProduct);
console.log('LOG: productRoutes.ts: POST / route defined.');

router.get('/:id', (req: Request, res: Response, next: NextFunction) => {
    console.log(`LOG: productRoutes.ts: Matched GET /:id (e.g., /api/products/${req.params.id}). Forwarding to getProductById controller.`);
    next();
}, getProductById);
console.log('LOG: productRoutes.ts: GET /:id route defined.');

router.put('/:id', protect, (req: Request, res: Response, next: NextFunction) => {
    console.log(`LOG: productRoutes.ts: Matched PUT /:id (e.g., /api/products/${req.params.id}). Forwarding to updateProduct controller.`);
    next();
}, updateProduct);
console.log('LOG: productRoutes.ts: PUT /:id route defined.');

router.delete('/:id', protect, (req: Request, res: Response, next: NextFunction) => {
    console.log(`LOG: productRoutes.ts: Matched DELETE /:id (e.g., /api/products/${req.params.id}). Forwarding to deleteProduct controller.`);
    next();
}, deleteProduct);
console.log('LOG: productRoutes.ts: DELETE /:id route defined.');

export default router;