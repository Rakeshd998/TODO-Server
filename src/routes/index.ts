import { Router } from 'express';
import authRoutes from './auth.routes';
import todoRoutes from './todo.routes';
import clipRoutes from './clip.routes';

const router = Router();

router.use('/auth',  authRoutes);
router.use('/todos', todoRoutes);
router.use('/clips', clipRoutes);

export default router;

