import { Router } from 'express';
import { getClips, createClip, updateClip, deleteClip } from '../controllers/clip.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticate); // all clip routes require auth

router.get('/',    getClips);
router.post('/',   createClip);
router.put('/:id', updateClip);
router.delete('/:id', deleteClip);

export default router;
