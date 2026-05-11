import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { getTodos, createTodo, updateTodo, deleteTodo } from '../controllers/todo.controller';

const router = Router();

// All todo routes require a valid access token
router.use(authenticate);

router.get('/', getTodos);
router.post('/', createTodo);
router.patch('/:id', updateTodo);
router.delete('/:id', deleteTodo);

export default router;
