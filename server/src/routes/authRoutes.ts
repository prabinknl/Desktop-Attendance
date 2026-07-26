import { Router } from 'express';
import { sendAdminCode, verifyAdminCode, sendInviteEmail, getUsers, syncUser, login } from '../controllers/authController.js';

const router = Router();

router.post('/admin/send-code', sendAdminCode);
router.post('/admin/verify-code', verifyAdminCode);
router.post('/admin/send-invite', sendInviteEmail);
router.get('/users', getUsers);
router.post('/users/sync', syncUser);
router.post('/login', login);

export default router;
