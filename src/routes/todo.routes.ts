import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
  getTodos,
  getTodoStats,
  createTodo,
  updateTodo,
  deleteTodo,
  restoreTodo,
} from '../controllers/todo.controller';

const router = Router();

// All todo routes require a valid access token
router.use(authenticate);

router.get('/', getTodos);
router.get('/stats', getTodoStats);
router.post('/', createTodo);
router.patch('/:id', updateTodo);
router.delete('/:id', deleteTodo);
router.post('/:id/restore', restoreTodo);

export default router;
