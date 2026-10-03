import { Router } from 'express';
import {
  register,
  login,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  deleteAccount,
  updateProfile,
  changePassword,
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
router.patch('/me',               authenticate, updateProfile);
router.post('/change-password',   authenticate, changePassword);

export default router;
