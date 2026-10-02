import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
  getUsers,
  getHistory,
  markRead,
  getUnreadCounts,
} from '../controllers/chat.controller';

const router = Router();

// All chat routes require authentication
router.use(authenticate);

router.get('/users',          getUsers);
router.get('/history/:userId', getHistory);
router.patch('/read/:userId', markRead);
router.get('/unread',         getUnreadCounts);

export default router;
