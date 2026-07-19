import { Router } from 'express';
import { sendAdminCode, verifyAdminCode } from '../controllers/authController.js';

const router = Router();

router.post('/admin/send-code', sendAdminCode);
router.post('/admin/verify-code', verifyAdminCode);

export default router;
