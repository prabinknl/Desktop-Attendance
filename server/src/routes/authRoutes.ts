import { Router } from 'express';
import {
  sendAdminCode,
  verifyAdminCode,
  sendInviteEmail,
  getInvitationByToken,
  markInvitationUsed,
  getUsers,
  syncUser,
  login,
} from '../controllers/authController.js';

const router = Router();

router.post('/admin/send-code', sendAdminCode);
router.post('/admin/verify-code', verifyAdminCode);
router.post('/admin/send-invite', sendInviteEmail);
router.get('/invitations/:token', getInvitationByToken);
router.post('/invitations/:token/use', markInvitationUsed);
router.get('/users', getUsers);
router.post('/users/sync', syncUser);
router.post('/login', login);

export default router;
