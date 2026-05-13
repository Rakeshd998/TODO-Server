import { Router } from 'express';
import {
  register,
  login,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  deleteAccount,
} from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.post('/register',         register);
router.post('/login',            login);
router.post('/refresh',          refresh);
router.post('/logout',           logout);
router.post('/forgot-password',  forgotPassword);
router.post('/reset-password/:token', resetPassword);
router.delete('/delete-account', authenticate, deleteAccount);

export default router;
